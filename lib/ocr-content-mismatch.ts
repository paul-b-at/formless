import type { OcrResponse } from "@/lib/ocr-types";

export type OcrContentMismatch = {
  message: string;
  detectedProductId: string;
  detectedProductTitle: string;
};

function detectedProduct(ocr: OcrResponse): {
  id: string;
  title: string;
} | null {
  const id = ocr.suggestedProductId ?? ocr.productId;
  if (!id) {
    return null;
  }

  const fromOptions = ocr.productOptions?.find((product) => product.id === id);
  const title = ocr.productTitle ?? fromOptions?.title;
  if (!title) {
    return null;
  }

  return { id, title };
}

/**
 * Advisory mismatch when OCR confidently maps the document to a different product
 * than the one the user is uploading for. Low confidence / no mapping → no warning.
 */
export function detectOcrContentMismatch(
  ocr: OcrResponse,
  selectedProductId: string,
  selectedProductTitle?: string,
): OcrContentMismatch | null {
  if (ocr.confidence !== "high") {
    return null;
  }

  if (ocr.ambiguousProduct) {
    return null;
  }

  const detected = detectedProduct(ocr);
  if (!detected || detected.id === selectedProductId) {
    return null;
  }

  if (ocr.alternativeProductIds?.includes(selectedProductId)) {
    return null;
  }

  const hint =
    ocr.extracted?.documentType?.trim() ||
    ocr.productHint?.trim() ||
    detected.title;

  const expected =
    selectedProductTitle?.trim() || "the product you selected";

  return {
    detectedProductId: detected.id,
    detectedProductTitle: detected.title,
    message: `This looks like ${hint}, not ${expected}. You can replace the file or continue anyway.`,
  };
}
