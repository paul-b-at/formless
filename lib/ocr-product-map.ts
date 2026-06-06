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

const GeminiPickSchema = {
  type: Type.OBJECT,
  properties: {
    productId: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING, nullable: true },
  },
  required: ["productId", "confidence"],
} as const;

async function geminiPickProduct(
  apiKey: string,
  context: string,
  catalog: ProductDefinition[],
): Promise<ProductDefinition | undefined> {
  if (catalog.length === 0) {
    return undefined;
  }

  const ai = new GoogleGenAI({ apiKey });
  const options = catalog
    .filter((product) => product.title.en !== "Auto-added product")
    .map((product) => `- ${product.id}: ${product.title.en ?? product.id}`)
    .join("\n");

  const prompt = `A user uploaded a legal document. Pick the closest REAL notary booking product.

Document context:
${context}

Available products (pick productId from this list exactly, or null if none fit):
${options}

Rules:
- Map on the document's PURPOSE / end goal, not only its title. Example: a Power of Attorney whose purpose is "obtaining a Spanish NIE" → Nie number application, NOT Signature notarisation.
- Prefer outcome products (NIE application, certified copy, etc.) when the document states a specific goal that matches the catalog.
- Use Signature notarisation only for generic PoA/declarations with NO more specific outcome product on the list.
- Return null if no product is a confident match.

Return JSON: { "productId": "<id from list or null>", "confidence": "high"|"medium"|"low"|null }`;

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
    };

    const confidence = parsed.confidence ?? "low";
    if (confidence === "low" || !parsed.productId) {
      return undefined;
    }

    const id = parsed.productId.trim();
    return catalog.find((product) => product.id === id);
  } catch {
    return undefined;
  }
}

export type ProductMapResult = {
  productId?: string;
  productTitle?: string;
  suggestedProductId?: string;
  alternativeProductIds?: string[];
  ambiguous?: boolean;
};

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
    return {
      productId: explicitPurpose.id,
      productTitle: explicitPurpose.title.en,
      suggestedProductId: explicitPurpose.id,
    };
  }

  if (
    purposeMatch &&
    instrumentMatch &&
    purposeMatch.id !== instrumentMatch.id
  ) {
    return {
      ambiguous: true,
      suggestedProductId: purposeMatch.id,
      alternativeProductIds: [instrumentMatch.id],
    };
  }

  if (purposeMatch) {
    return {
      productId: purposeMatch.id,
      productTitle: purposeMatch.title.en,
      suggestedProductId: purposeMatch.id,
    };
  }

  if (directMatch) {
    return {
      productId: directMatch.id,
      productTitle: directMatch.title.en,
      suggestedProductId: directMatch.id,
    };
  }

  if (instrumentMatch) {
    return {
      productId: instrumentMatch.id,
      productTitle: instrumentMatch.title.en,
      suggestedProductId: instrumentMatch.id,
    };
  }

  if (args.apiKey && fullContext.trim()) {
    const picked = await geminiPickProduct(
      args.apiKey,
      fullContext,
      args.catalog,
    );
    if (picked) {
      return {
        productId: picked.id,
        productTitle: picked.title.en,
        suggestedProductId: picked.id,
      };
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
