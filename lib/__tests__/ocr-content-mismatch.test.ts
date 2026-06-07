import { describe, expect, test } from "bun:test";

import { detectOcrContentMismatch } from "../ocr-content-mismatch";
import type { OcrResponse } from "../ocr-types";

describe("detectOcrContentMismatch", () => {
  const selectedId = "UpEJ7raQEKQKFhWn12r2";

  test("no warning when detected product matches selection", () => {
    const ocr: OcrResponse = {
      productId: selectedId,
      productTitle: "Nie number application",
      suggestedProductId: selectedId,
      confidence: "high",
    };
    expect(detectOcrContentMismatch(ocr, selectedId)).toBeNull();
  });

  test("no warning on low confidence", () => {
    const ocr: OcrResponse = {
      productId: "other-id",
      productTitle: "Signature notarisation",
      suggestedProductId: "other-id",
      confidence: "low",
    };
    expect(detectOcrContentMismatch(ocr, selectedId)).toBeNull();
  });

  test("no warning when selected product is an alternative", () => {
    const ocr: OcrResponse = {
      productId: "other-id",
      productTitle: "Signature notarisation",
      suggestedProductId: "other-id",
      alternativeProductIds: [selectedId],
      confidence: "high",
    };
    expect(detectOcrContentMismatch(ocr, selectedId)).toBeNull();
  });

  test("warns on high-confidence mismatch", () => {
    const ocr: OcrResponse = {
      productId: "ujwBkZleJLPEzByCnPCS",
      productTitle: "Signature notarisation",
      suggestedProductId: "ujwBkZleJLPEzByCnPCS",
      productHint: "Power of Attorney",
      extracted: { documentType: "Power of Attorney" },
      confidence: "high",
    };
    const mismatch = detectOcrContentMismatch(
      ocr,
      selectedId,
      "Nie number application",
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch?.detectedProductId).toBe("ujwBkZleJLPEzByCnPCS");
    expect(mismatch?.message).toContain("Power of Attorney");
    expect(mismatch?.message).toContain("Nie number application");
  });

  test("Joshua fixture aligns with NIE product selection", () => {
    const ocr: OcrResponse = {
      destinationCountry: "ES",
      productHint: "Power of Attorney",
      purposeHint: "obtaining a Spanish Foreign Identity Number (NIE)",
      productId: selectedId,
      productTitle: "Nie number application",
      suggestedProductId: selectedId,
      extracted: {
        documentType: "Power of Attorney",
        summary: "Power of Attorney authorising an agent to obtain a Spanish NIE",
      },
      confidence: "high",
    };
    expect(detectOcrContentMismatch(ocr, selectedId)).toBeNull();
  });

  test("Robert fixture aligns with signature notarisation selection", () => {
    const signatureId = "ujwBkZleJLPEzByCnPCS";
    const ocr: OcrResponse = {
      productId: signatureId,
      productTitle: "Signature notarisation",
      suggestedProductId: signatureId,
      productHint: "Power of Attorney",
      extracted: { documentType: "Special Power of Attorney" },
      confidence: "high",
    };
    expect(detectOcrContentMismatch(ocr, signatureId)).toBeNull();
  });

  test("Elizabeth fixture aligns with FlexCo selection", () => {
    const flexCoId = "S3N2zyJENFE0vTjrKTZn";
    const ocr: OcrResponse = {
      productId: flexCoId,
      productTitle: "FlexCo Incorporation",
      suggestedProductId: flexCoId,
      productHint: "Gesellschaftsvertrag",
      extracted: { documentType: "Gesellschaftsvertrag" },
      confidence: "high",
    };
    expect(detectOcrContentMismatch(ocr, flexCoId)).toBeNull();
  });
});
