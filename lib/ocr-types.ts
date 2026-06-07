import { z } from "zod";

/** Loose hint string — null means "not found in the document". */
const ocrString = z.string().nullable().optional();

const ocrCountryCode = z.string().length(2).nullable().optional();

/** Partial party hints from OCR — NOT the strict booking Party schema. */
export const OcrPartySchema = z
  .object({
    firstName: ocrString,
    lastName: ocrString,
    email: ocrString,
    phoneNumber: ocrString,
    address: ocrString,
    zipCode: ocrString,
    city: ocrString,
    stateProvince: ocrString,
    countryCode: ocrCountryCode,
    companyName: ocrString,
  })
  .nullable()
  .optional();

export const OcrExtractedSchema = z
  .object({
    party: OcrPartySchema,
    documentType: ocrString,
    summary: ocrString,
  })
  .nullable()
  .optional();

export const OcrGeminiRawSchema = z.object({
  destinationCountry: ocrCountryCode,
  productHint: ocrString,
  purposeHint: ocrString,
  extracted: OcrExtractedSchema,
  confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
});

export const OcrProductOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const OcrCountryOptionSchema = z.object({
  code: z.string().length(2),
  label: z.string(),
});

export const OcrResponseSchema = z.object({
  destinationCountry: ocrCountryCode,
  destinationCountryLabel: ocrString,
  productHint: ocrString,
  purposeHint: ocrString,
  productId: ocrString,
  productTitle: ocrString,
  suggestedProductId: ocrString,
  productConfidence: z.enum(["high", "medium", "low"]).optional(),
  productMatchReason: ocrString,
  alternativeProductIds: z.array(z.string()).optional(),
  ambiguousProduct: z.boolean().optional(),
  countryOptions: z.array(OcrCountryOptionSchema).optional(),
  productOptions: z.array(OcrProductOptionSchema).optional(),
  extracted: OcrExtractedSchema,
  confidence: z.enum(["high", "medium", "low"]).optional(),
  notice: ocrString,
});

export type OcrParty = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  zipCode?: string;
  city?: string;
  stateProvince?: string;
  countryCode?: string;
  companyName?: string;
};

export type OcrExtracted = {
  party?: OcrParty;
  documentType?: string;
  summary?: string;
};

export type OcrResponse = z.infer<typeof OcrResponseSchema>;

function stripEmptyValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (Array.isArray(value)) {
    const items = value
      .map(stripEmptyValue)
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      const cleaned = stripEmptyValue(entry);
      if (cleaned !== undefined) {
        next[key] = cleaned;
      }
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }
  return value;
}

function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const upper = value.trim().toUpperCase();
  return upper.length === 2 ? upper : undefined;
}

function normalizeConfidence(
  value: unknown,
): "high" | "medium" | "low" | undefined {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return undefined;
}

/** Drop null/empty OCR fields before returning to the client. */
export function normalizeOcrResponse(raw: {
  destinationCountry?: unknown;
  destinationCountryLabel?: unknown;
  productHint?: unknown;
  purposeHint?: unknown;
  productId?: unknown;
  productTitle?: unknown;
  suggestedProductId?: unknown;
  productConfidence?: unknown;
  productMatchReason?: unknown;
  alternativeProductIds?: unknown;
  ambiguousProduct?: unknown;
  countryOptions?: unknown;
  productOptions?: unknown;
  extracted?: unknown;
  confidence?: unknown;
  notice?: unknown;
}): OcrResponse {
  const extracted = stripEmptyValue(raw.extracted) as OcrExtracted | undefined;
  const party = extracted?.party
    ? (stripEmptyValue({
        ...extracted.party,
        countryCode: normalizeCountryCode(extracted.party.countryCode),
      }) as OcrParty | undefined)
    : undefined;

  const normalized = {
    destinationCountry: normalizeCountryCode(raw.destinationCountry),
    destinationCountryLabel: stripEmptyValue(
      raw.destinationCountryLabel,
    ) as string | undefined,
    productHint: stripEmptyValue(raw.productHint) as string | undefined,
    purposeHint: stripEmptyValue(raw.purposeHint) as string | undefined,
    productId: stripEmptyValue(raw.productId) as string | undefined,
    productTitle: stripEmptyValue(raw.productTitle) as string | undefined,
    suggestedProductId: stripEmptyValue(raw.suggestedProductId) as
      | string
      | undefined,
    productConfidence: normalizeConfidence(raw.productConfidence),
    productMatchReason: stripEmptyValue(raw.productMatchReason) as
      | string
      | undefined,
    alternativeProductIds: Array.isArray(raw.alternativeProductIds)
      ? raw.alternativeProductIds
          .map((entry) => stripEmptyValue(entry))
          .filter((entry): entry is string => typeof entry === "string")
      : undefined,
    ambiguousProduct: raw.ambiguousProduct === true ? true : undefined,
    countryOptions: stripEmptyValue(raw.countryOptions) as
      | { code: string; label: string }[]
      | undefined,
    productOptions: stripEmptyValue(raw.productOptions) as
      | { id: string; title: string }[]
      | undefined,
    confidence: normalizeConfidence(raw.confidence),
    notice: stripEmptyValue(raw.notice) as string | undefined,
    extracted:
      extracted || party
        ? {
            ...extracted,
            ...(party ? { party } : {}),
          }
        : undefined,
  };

  const cleaned = stripEmptyValue(normalized) as Record<string, unknown>;
  return OcrResponseSchema.parse(cleaned ?? {});
}

/** Strip null/empty party hints for client state (OcrParty uses undefined, not null). */
export function normalizeOcrParty(
  party: Record<string, unknown> | OcrParty | null | undefined,
): OcrParty | null {
  if (!party) {
    return null;
  }
  const cleaned = stripEmptyValue({
    ...party,
    countryCode: normalizeCountryCode(
      (party as OcrParty).countryCode ?? (party as Record<string, unknown>).countryCode,
    ),
  }) as OcrParty | undefined;
  return cleaned ?? null;
}
