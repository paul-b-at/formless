import { describe, expect, test } from "bun:test";

import { validatePdfUpload } from "../upload-validation";

describe("validatePdfUpload", () => {
  const validPdf = Buffer.from("%PDF-1.4 fake content");

  test("accepts a valid PDF", () => {
    expect(
      validatePdfUpload({
        bytes: validPdf,
        fileName: "doc.pdf",
        mimeType: "application/pdf",
      }),
    ).toEqual({ ok: true });
  });

  test("rejects non-pdf extension", () => {
    const result = validatePdfUpload({
      bytes: validPdf,
      fileName: "doc.png",
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("valid PDF");
    }
  });

  test("rejects wrong mime type", () => {
    const result = validatePdfUpload({
      bytes: validPdf,
      fileName: "doc.pdf",
      mimeType: "image/png",
    });
    expect(result.ok).toBe(false);
  });

  test("rejects missing PDF magic bytes", () => {
    const result = validatePdfUpload({
      bytes: Buffer.from("not a pdf"),
      fileName: "doc.pdf",
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("corrupt");
    }
  });

  test("rejects oversized files", () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x25);
    huge.write("%PDF-", 0, "ascii");
    const result = validatePdfUpload({
      bytes: huge,
      fileName: "big.pdf",
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("too large");
    }
  });
});
