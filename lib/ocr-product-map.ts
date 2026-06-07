import { GoogleGenAI, Type } from "@google/genai";

import { GEMINI_MODEL } from "./gemini-model";
import type { ProductDefinition } from "./form-interpreter";

/** Document purpose / end-goal — checked before generic instrument type. */
const PURPOSE_TO_PRODUCT: [RegExp, string][] = [
  [
    /nie|foreign\s+identity\s+number|n[uú]mero\s+de\s+identidad|identidad\s+de\s+extranjero/i,
    "nie number application",
  ],
  [/certification\s+of\s+facts/i, "certification of facts"],
  [/certified\s+copy/i, "certified copy"],
  [/\bpassport\b/i, "certified copy"],
  [/signature\s+notaris/i, "signature notarisation"],
];

/** Generic instrument type — only when no purpose-specific product matches. */
const INSTRUMENT_TO_PRODUCT: [RegExp, string][] = [
  [/power\s+of\s+attorney|\bpoa\b/i, "signature notarisation"],
  [/declaration|affidavit|statutory\s+declaration/i, "signature notarisation"],
];

export type CatalogProductCandidate = {
  id: string;
  name: string;
  description: string;
};

export type ProductMapConfidence = "high" | "medium" | "low";

export type ProductMapResult = {
  productId?: string;
  productTitle?: string;
  suggestedProductId?: string;
  alternativeProductIds?: string[];
  ambiguous?: boolean;
  productConfidence?: ProductMapConfidence;
  productMatchReason?: string;
};

function catalogByTitle(
  catalog: ProductDefinition[],
  titleNeedle: string,
): ProductDefinition | undefined {
  const needle = titleNeedle.toLowerCase();
  return catalog.find((product) => {
    const title = product.title.en?.toLowerCase() ?? "";
    return title.includes(needle) || needle.includes(title);
  });
}

function matchFromPatterns(
  text: string,
  patterns: [RegExp, string][],
  catalog: ProductDefinition[],
): ProductDefinition | undefined {
  for (const [pattern, titleNeedle] of patterns) {
    if (!pattern.test(text)) {
      continue;
    }
    const match = catalogByTitle(catalog, titleNeedle);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function directCatalogMatch(
  hint: string,
  catalog: ProductDefinition[],
): ProductDefinition | undefined {
  const text = hint.toLowerCase();
  for (const product of catalog) {
    const title = product.title.en?.toLowerCase() ?? "";
    if (!title) {
      continue;
    }
    if (text.includes(title) || title.includes(text)) {
      return product;
    }
  }
  return undefined;
}

function combineDocumentContext(args: {
  productHint: string;
  documentType?: string;
  summary?: string;
  purposeHint?: string;
}): string {
  return [
    args.purposeHint,
    args.summary,
    args.documentType,
    args.productHint,
  ]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ");
}

const GENERIC_MATCH_TOKENS = new Set([
  "about",
  "agreement",
  "application",
  "articles",
  "association",
  "change",
  "commercial",
  "company",
  "copy",
  "copies",
  "director",
  "document",
  "documents",
  "establish",
  "estate",
  "formation",
  "general",
  "letter",
  "liability",
  "limited",
  "liquidation",
  "managing",
  "notaries",
  "notary",
  "notarisation",
  "number",
  "online",
  "other",
  "partner",
  "partnership",
  "power",
  "purchase",
  "real",
  "register",
  "registered",
  "seat",
  "shares",
  "special",
  "transfer",
  "type",
  "unknown",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (token) => token.length >= 3 && !GENERIC_MATCH_TOKENS.has(token),
    );
}

function overlapScore(
  context: string,
  text: string,
  weight: number,
): number {
  const normalizedContext = context.toLowerCase();
  const contextTokens = new Set(tokenize(context));
  let score = 0;

  for (const token of tokenize(text)) {
    if (contextTokens.has(token)) {
      score += token.length * weight;
      continue;
    }
    if (normalizedContext.includes(token)) {
      score += token.length * weight * 0.75;
    }
  }

  return score;
}

function scoreCatalogProduct(
  context: string,
  product: ProductDefinition,
): { total: number; title: number } {
  const title = product.title.en ?? product.id;
  const description = product.description?.en ?? "";
  const titleScore = overlapScore(context, title, 3);
  const descriptionScore = overlapScore(context, description, 1);
  return {
    total: titleScore + descriptionScore,
    title: titleScore,
  };
}

function matchResult(
  product: ProductDefinition,
  confidence: ProductMapConfidence,
  reason: string,
): ProductMapResult {
  if (confidence !== "high") {
    return {};
  }
  const title = product.title.en ?? product.id;
  return {
    productTitle: title,
    suggestedProductId: product.id,
    productConfidence: "high",
    productMatchReason: reason,
  };
}

export function catalogProductCandidates(
  catalog: ProductDefinition[],
): CatalogProductCandidate[] {
  return catalog
    .filter((product) => product.title.en !== "Auto-added product")
    .map((product) => ({
      id: product.id,
      name: product.title.en ?? product.id,
      description: product.description?.en?.trim() ?? "",
    }));
}

function semanticCatalogMatch(
  context: string,
  catalog: ProductDefinition[],
): ProductMapResult | undefined {
  const trimmed = context.trim();
  if (!trimmed) {
    return undefined;
  }

  const scored = catalog
    .filter((product) => product.title.en !== "Auto-added product")
    .map((product) => ({
      product,
      ...scoreCatalogProduct(trimmed, product),
    }))
    .filter((entry) => entry.title > 0)
    .sort((left, right) =>
      right.total !== left.total
        ? right.total - left.total
        : right.title - left.title,
    );

  if (scored.length === 0) {
    return undefined;
  }

  const best = scored[0]!;
  const second = scored[1];
  const ratio = second ? best.total / second.total : Number.POSITIVE_INFINITY;

  if (best.total >= 12 && best.title >= 9 && ratio >= 1.5) {
    return matchResult(
      best.product,
      "high",
      `Catalog match on "${best.product.title.en ?? best.product.id}" (${Math.round(best.total)} pts)`,
    );
  }

  return undefined;
}

const GeminiPickSchema = {
  type: Type.OBJECT,
  properties: {
    productId: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING, nullable: true },
    reason: { type: Type.STRING, nullable: true },
  },
  required: ["productId", "confidence", "reason"],
} as const;

async function geminiPickProduct(
  apiKey: string,
  context: string,
  catalog: ProductDefinition[],
): Promise<ProductMapResult | undefined> {
  const candidates = catalogProductCandidates(catalog);
  if (candidates.length === 0) {
    return undefined;
  }

  const ai = new GoogleGenAI({ apiKey });
  const options = candidates
    .map((product) => {
      const description = product.description
        ? ` — ${product.description}`
        : "";
      return `- ${product.id}: ${product.name}${description}`;
    })
    .join("\n");

  const prompt = `A user uploaded a legal document. Pick the closest REAL notary booking product from the catalog.

Document context:
${context}

Available products (return productId from this list exactly, or null if none fit):
${options}

Rules:
- Map on the document's PURPOSE / end goal, not only its title. Example: a Power of Attorney whose purpose is "obtaining a Spanish NIE" → Nie number application, NOT Signature notarisation.
- Prefer outcome products (NIE application, certified copy, incorporation, etc.) when the document states a specific goal that matches the catalog.
- Use Signature notarisation only for generic PoA/declarations with NO more specific outcome product on the list.
- Return null if no product is a confident match.

Return JSON: { "productId": "<id from list or null>", "confidence": "high"|"medium"|"low"|null, "reason": "<short why>" }`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: GeminiPickSchema,
      },
    });

    const text = response.text;
    if (!text) {
      return undefined;
    }

    const parsed = JSON.parse(text) as {
      productId?: string | null;
      confidence?: string | null;
      reason?: string | null;
    };

    const confidence = parsed.confidence ?? "low";
    if (confidence === "low" || !parsed.productId) {
      return undefined;
    }

    const id = parsed.productId.trim();
    const product = catalog.find((entry) => entry.id === id);
    if (!product) {
      return undefined;
    }

    if (confidence !== "high") {
      return undefined;
    }

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : `Model matched "${product.title.en ?? product.id}"`;

    return matchResult(product, "high", reason);
  } catch {
    return undefined;
  }
}

/** Map document context to catalog product(s). Purpose beats instrument type. */
export async function mapDocumentHintToProduct(args: {
  productHint: string;
  documentType?: string;
  summary?: string;
  purposeHint?: string;
  catalog: ProductDefinition[];
  apiKey?: string;
}): Promise<ProductMapResult> {
  const hint = args.productHint.trim();
  if (args.catalog.length === 0) {
    return {};
  }

  const fullContext = combineDocumentContext(args);
  const goalText = [args.purposeHint, args.summary]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ");
  const instrumentContext = [args.documentType, args.productHint]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ");

  const explicitPurpose = goalText
    ? matchFromPatterns(goalText, PURPOSE_TO_PRODUCT, args.catalog)
    : undefined;
  const purposeMatch = matchFromPatterns(
    fullContext,
    PURPOSE_TO_PRODUCT,
    args.catalog,
  );
  const instrumentMatch = instrumentContext
    ? matchFromPatterns(
        instrumentContext,
        INSTRUMENT_TO_PRODUCT,
        args.catalog,
      )
    : undefined;
  const directMatch = hint ? directCatalogMatch(hint, args.catalog) : undefined;

  if (explicitPurpose) {
    return matchResult(
      explicitPurpose,
      "high",
      `Document purpose matches "${explicitPurpose.title.en ?? explicitPurpose.id}"`,
    );
  }

  if (
    purposeMatch &&
    instrumentMatch &&
    purposeMatch.id !== instrumentMatch.id
  ) {
    return {
      ambiguous: true,
      alternativeProductIds: [purposeMatch.id, instrumentMatch.id],
    };
  }

  if (purposeMatch) {
    return matchResult(
      purposeMatch,
      "high",
      `Document purpose matches "${purposeMatch.title.en ?? purposeMatch.id}"`,
    );
  }

  if (directMatch) {
    return matchResult(
      directMatch,
      "high",
      `Document type matches catalog product "${directMatch.title.en ?? directMatch.id}"`,
    );
  }

  if (instrumentMatch) {
    return matchResult(
      instrumentMatch,
      "high",
      `Instrument type matches "${instrumentMatch.title.en ?? instrumentMatch.id}"`,
    );
  }

  const semantic = semanticCatalogMatch(fullContext, args.catalog);
  if (semantic?.productConfidence === "high") {
    return semantic;
  }

  if (args.apiKey && fullContext.trim()) {
    const picked = await geminiPickProduct(args.apiKey, fullContext, args.catalog);
    if (picked) {
      return picked;
    }
  }

  return {};
}

export function isCatalogProductId(
  productId: string,
  catalog: ProductDefinition[],
): boolean {
  return catalog.some((product) => product.id === productId);
}

export function catalogProductOptions(
  catalog: ProductDefinition[],
): { id: string; title: string }[] {
  return catalog
    .filter((product) => product.title.en !== "Auto-added product")
    .map((product) => ({
      id: product.id,
      title: product.title.en ?? product.id,
    }));
}

/** True when OCR should highlight one catalog product as a tappable suggestion. */
export function hasOcrProductSuggestion(ocr: {
  suggestedProductId?: string | null;
  productConfidence?: ProductMapConfidence;
  ambiguousProduct?: boolean;
}): boolean {
  return Boolean(
    ocr.suggestedProductId &&
      ocr.productConfidence === "high" &&
      !ocr.ambiguousProduct,
  );
}

export function sortProductOptionsWithSuggestion(
  options: { id: string; title: string }[],
  suggestedProductId: string | undefined,
): { id: string; title: string }[] {
  if (!suggestedProductId) {
    return options;
  }
  return [...options].sort((left, right) => {
    if (left.id === suggestedProductId) {
      return -1;
    }
    if (right.id === suggestedProductId) {
      return 1;
    }
    return 0;
  });
}
