import type { OcrResponse } from "./ocr-types";

/** Raw instrument type from OCR — not the mapped booking product. */
function detectedDocumentLabel(ocr: OcrResponse): string | undefined {
  const fromExtracted = ocr.extracted?.documentType;
  if (typeof fromExtracted === "string" && fromExtracted.trim()) {
    return fromExtracted.trim();
  }
  if (typeof ocr.productHint === "string" && ocr.productHint.trim()) {
    return ocr.productHint.trim();
  }
  return undefined;
}

export function formatOcrSummary(ocr: OcrResponse, fileName: string): string {
  if (ocr.notice) {
    return ocr.notice;
  }

  const lines = [`I read ${fileName}. Here's what I picked up:`];

  if (ocr.destinationCountry) {
    const label = ocr.destinationCountryLabel ?? ocr.destinationCountry;
    const flag =
      ocr.destinationCountry === "ES"
        ? " 🇪🇸"
        : ocr.destinationCountry === "AT"
          ? " 🇦🇹"
          : "";
    lines.push("");
    lines.push(`Looks like this is for ${label}${flag}.`);
  }

  if (ocr.ambiguousProduct) {
    lines.push("");
    lines.push(
      "This document could match more than one booking product — pick the right one below.",
    );
  } else if (ocr.suggestedProductId && ocr.productTitle) {
    lines.push("");
    const detected = detectedDocumentLabel(ocr);
    const booking = ocr.productTitle;
    if (detected && detected.toLowerCase() !== booking.toLowerCase()) {
      lines.push(`Detected: ${detected} → booking as ${booking}. Correct?`);
    } else {
      lines.push(`Best match: ${booking}`);
    }
  } else if (ocr.productHint || ocr.purposeHint) {
    lines.push("");
    lines.push(
      `Document: ${ocr.productHint ?? ocr.purposeHint} — pick the booking product below.`,
    );
  }

  if (ocr.extracted?.summary) {
    lines.push(`Summary: ${ocr.extracted.summary}`);
  }

  const party = ocr.extracted?.party;
  if (party?.firstName || party?.lastName) {
    lines.push(
      `Name on document: ${[party.firstName, party.lastName].filter(Boolean).join(" ")}`,
    );
  }
  if (party?.address) {
    lines.push(`Address on document: ${party.address}`);
  }

  lines.push("");
  lines.push("Tap your country and product below — one tap each to continue.");

  return lines.join("\n");
}
