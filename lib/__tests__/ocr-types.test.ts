import { describe, expect, test } from "bun:test";

import {
  normalizeOcrResponse,
  OcrGeminiRawSchema,
  OcrResponseSchema,
} from "../ocr-types";

describe("OCR schemas", () => {
  test("accepts null party fields from Gemini", () => {
    const raw = {
      destinationCountry: "ES",
      productHint: "NIE number application",
      extracted: {
        party: {
          firstName: "Joshua",
          lastName: "Timms",
          email: null,
          phoneNumber: null,
          address: "5th Ave 350",
        },
        documentType: "NIE application",
        summary: null,
      },
      confidence: null,
    };

    expect(() => OcrGeminiRawSchema.parse(raw)).not.toThrow();

    const normalized = normalizeOcrResponse({
      ...raw,
      productId: "UpEJ7raQEKQKFhWn12r2",
      productTitle: "Nie number application",
    });

    expect(normalized.extracted?.party?.firstName).toBe("Joshua");
    expect(normalized.extracted?.party?.email).toBeUndefined();
    expect(normalized.extracted?.party?.phoneNumber).toBeUndefined();
    expect(normalized.extracted?.summary).toBeUndefined();
    expect(normalized.confidence).toBeUndefined();
    expect(() => OcrResponseSchema.parse(normalized)).not.toThrow();
  });

  test("accepts entirely missing extracted block", () => {
    const normalized = normalizeOcrResponse({
      destinationCountry: "ES",
      productHint: "NIE application",
    });

    expect(normalized.destinationCountry).toBe("ES");
    expect(normalized.extracted).toBeUndefined();
  });

  test("does not validate OCR email as a real address", () => {
    const normalized = normalizeOcrResponse({
      extracted: {
        party: {
          email: "maybe-an-email",
        },
      },
    });

    expect(normalized.extracted?.party?.email).toBe("maybe-an-email");
  });
});
