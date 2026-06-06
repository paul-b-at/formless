import "server-only";

import { GoogleGenAI, Type } from "@google/genai";

import { isOcrMockEnabled, ocrCacheKey, readOcrCache } from "./ocr-cache";
import {
  generateContentWithOcrFallback,
  OCR_READ_FAILED_NOTICE,
} from "./gemini-ocr";
import {
  catalogProductOptions,
  isCatalogProductId,
  mapDocumentHintToProduct,
  type ProductMapResult,
} from "./ocr-product-map";
import {
  getCountryOptions,
  getVisibleProductPickerTags,
  parseBookingForm,
  type ProductDefinition,
} from "./form-interpreter";
import { getBookingForm, getProductsByTags } from "./notarity";
import {
  normalizeOcrResponse,
  OcrGeminiRawSchema,
  type OcrResponse,
} from "./ocr-types";

const FORM_SLUG = "start-vienna-hackathon";

const OCR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    destinationCountry: { type: Type.STRING, nullable: true },
    productHint: { type: Type.STRING, nullable: true },
    purposeHint: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING, nullable: true },
    extracted: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        documentType: { type: Type.STRING, nullable: true },
        summary: { type: Type.STRING, nullable: true },
        party: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            firstName: { type: Type.STRING, nullable: true },
            lastName: { type: Type.STRING, nullable: true },
            email: { type: Type.STRING, nullable: true },
            phoneNumber: { type: Type.STRING, nullable: true },
            address: { type: Type.STRING, nullable: true },
            zipCode: { type: Type.STRING, nullable: true },
            city: { type: Type.STRING, nullable: true },
            stateProvince: { type: Type.STRING, nullable: true },
            countryCode: { type: Type.STRING, nullable: true },
          },
        },
      },
    },
  },
} as const;

function normalizeProductDefs(raw: Record<string, unknown>[]): ProductDefinition[] {
  return raw.map((product) => ({
    id: String(product.id ?? product._id ?? ""),
    title: {
      en:
        typeof product.title === "object" && product.title !== null
          ? String((product.title as Record<string, unknown>).en ?? "")
          : String(product.title ?? product.name ?? product.id ?? ""),
    },
    apostilleRequired: Boolean(product.apostilleRequired),
    fileUploadRequired: Boolean(product.fileUploadRequired),
  }));
}

function countryLabel(code: string): string {
  const display = new Intl.DisplayNames("en", { type: "region" });
  return display.of(code) ?? code;
}

async function loadCatalogForCountry(
  destinationCountry: string | undefined,
): Promise<ProductDefinition[]> {
  const rawForm = await getBookingForm(FORM_SLUG);
  const form = parseBookingForm(rawForm);
  const collected = destinationCountry ? { destinationCountry } : {};
  const tags = getVisibleProductPickerTags(form, collected);
  if (tags.length === 0) {
    return [];
  }
  const products = await getProductsByTags(tags);
  return normalizeProductDefs(products as Record<string, unknown>[]);
}

async function loadCountryOptions(): Promise<{ code: string; label: string }[]> {
  const rawForm = await getBookingForm(FORM_SLUG);
  const form = parseBookingForm(rawForm);
  return getCountryOptions(form).map((country) => ({
    code: country.code,
    label: country.label,
  }));
}

function buildOcrPrompt(fileName: string): string {
  return `You are helping pre-fill a notary booking form. Read this document (${fileName}) and extract:
- destinationCountry: ISO-3166 alpha-2 country code where the document will be used (e.g. ES for Spain, AT for Austria)
- productHint: what KIND of document this is in plain English (e.g. "Power of Attorney", "passport copy") — NOT a booking product name
- purposeHint: the document's stated PURPOSE or end goal (e.g. "obtaining a Spanish NIE", "company formation", "property purchase") — read what the doc is FOR, not only what it is called
- extracted.party: any obvious person details (firstName, lastName, email, phoneNumber, address, zipCode, city, stateProvince, countryCode as ISO-2)
- extracted.documentType: document type in plain English
- extracted.summary: one sentence describing the document and its goal
- confidence: high | medium | low

Return JSON only. Use uppercase ISO-2 for country codes. Use null for any field you cannot read from the document (very common for email and phone). If unsure, use null rather than guessing.`;
}

async function enrichMappedProduct(
  parsed: ReturnType<typeof OcrGeminiRawSchema.parse>,
  apiKey: string,
): Promise<
  ProductMapResult & {
    productOptions?: { id: string; title: string }[];
  }
> {
  const rawCountry =
    typeof parsed.destinationCountry === "string"
      ? parsed.destinationCountry.trim().toUpperCase()
      : "";
  const destinationCountry =
    rawCountry.length === 2 ? rawCountry : undefined;

  const productHint =
    typeof parsed.productHint === "string" ? parsed.productHint.trim() : "";
  const purposeHint =
    typeof parsed.purposeHint === "string" ? parsed.purposeHint.trim() : "";

  if (!destinationCountry) {
    return {};
  }

  const catalog = await loadCatalogForCountry(destinationCountry);
  const productOptions = catalogProductOptions(catalog);

  if (!productHint && !purposeHint && !parsed.extracted?.summary) {
    return { productOptions };
  }

  const mapped = await mapDocumentHintToProduct({
    productHint,
    purposeHint: purposeHint || undefined,
    documentType: parsed.extracted?.documentType ?? undefined,
    summary: parsed.extracted?.summary ?? undefined,
    catalog,
    apiKey,
  });

  if (mapped.ambiguous) {
    return {
      ...mapped,
      productOptions,
    };
  }

  if (
    mapped.productId &&
    mapped.productTitle &&
    isCatalogProductId(mapped.productId, catalog)
  ) {
    return {
      productId: mapped.productId,
      productTitle: mapped.productTitle,
      suggestedProductId: mapped.suggestedProductId ?? mapped.productId,
      productOptions,
    };
  }

  return { productOptions };
}

function parseGeminiExtraction(
  text: string | undefined,
): ReturnType<typeof OcrGeminiRawSchema.parse> | null {
  if (!text?.trim()) {
    return null;
  }

  try {
    return OcrGeminiRawSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

async function hydrateCachedResponse(cached: OcrResponse): Promise<OcrResponse> {
  const countryOptions = await loadCountryOptions();
  const catalog = cached.destinationCountry
    ? await loadCatalogForCountry(cached.destinationCountry)
    : [];
  const productOptions =
    catalog.length > 0 ? catalogProductOptions(catalog) : cached.productOptions;

  return normalizeOcrResponse({
    ...cached,
    destinationCountryLabel: cached.destinationCountry
      ? countryLabel(cached.destinationCountry)
      : cached.destinationCountryLabel,
    countryOptions,
    productOptions,
  });
}

async function toOcrResponse(
  parsed: ReturnType<typeof OcrGeminiRawSchema.parse> | null,
  mapped: ProductMapResult & {
    productOptions?: { id: string; title: string }[];
  },
  notice?: string,
): Promise<OcrResponse> {
  const countryOptions = await loadCountryOptions();

  if (!parsed) {
    return normalizeOcrResponse({ notice, countryOptions });
  }

  const rawCountry =
    typeof parsed.destinationCountry === "string"
      ? parsed.destinationCountry.trim().toUpperCase()
      : "";
  const destinationCountry =
    rawCountry.length === 2 ? rawCountry : undefined;

  const productHint =
    typeof parsed.productHint === "string" ? parsed.productHint.trim() : "";
  const purposeHint =
    typeof parsed.purposeHint === "string" ? parsed.purposeHint.trim() : "";

  return normalizeOcrResponse({
    destinationCountry,
    destinationCountryLabel: destinationCountry
      ? countryLabel(destinationCountry)
      : undefined,
    productHint: productHint || undefined,
    purposeHint: purposeHint || undefined,
    productId: mapped.ambiguous ? undefined : mapped.productId,
    productTitle: mapped.ambiguous ? undefined : mapped.productTitle,
    suggestedProductId: mapped.suggestedProductId,
    alternativeProductIds: mapped.alternativeProductIds,
    ambiguousProduct: mapped.ambiguous ? true : undefined,
    countryOptions,
    productOptions: mapped.productOptions,
    extracted: parsed.extracted,
    confidence: parsed.confidence,
    notice,
  });
}

export async function inferFromDocument(args: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<OcrResponse> {
  if (isOcrMockEnabled()) {
    const cached = readOcrCache(args.fileName);
    if (cached) {
      return hydrateCachedResponse(cached);
    }

    const countryOptions = await loadCountryOptions();
    const key = ocrCacheKey(args.fileName);
    return normalizeOcrResponse({
      notice: `No OCR cache for "${args.fileName}". Add .ocr-cache/${key}.json or unset OCR_MOCK.`,
      countryOptions,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const countryOptions = await loadCountryOptions();
    return normalizeOcrResponse({
      notice: OCR_READ_FAILED_NOTICE,
      countryOptions,
    });
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64 = args.bytes.toString("base64");
  const prompt = buildOcrPrompt(args.fileName);

  const generated = await generateContentWithOcrFallback(ai, {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: args.mimeType,
              data: base64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: OCR_RESPONSE_SCHEMA,
    },
  });

  if (!generated.ok) {
    const countryOptions = await loadCountryOptions();
    return normalizeOcrResponse({
      notice: generated.notice,
      countryOptions,
    });
  }

  const parsed = parseGeminiExtraction(generated.text);
  const mapped = parsed ? await enrichMappedProduct(parsed, apiKey) : {};
  return toOcrResponse(parsed, mapped);
}
