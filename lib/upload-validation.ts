const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadValidationResult =
  | { ok: true }
  | { ok: false; error: string };

function hasPdfExtension(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith(".pdf");
}

function isPdfMimeType(mimeType: string | undefined): boolean {
  return mimeType?.trim().toLowerCase() === "application/pdf";
}

function hasPdfMagicBytes(bytes: Buffer): boolean {
  if (bytes.length < PDF_MAGIC.length) {
    return false;
  }
  return bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

/** Server-side PDF gate — extension, MIME, magic bytes, and size. */
export function validatePdfUpload(args: {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
}): UploadValidationResult {
  if (args.bytes.length === 0) {
    return { ok: false, error: "Missing file upload (field name: file)" };
  }

  if (args.bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File too large — please upload a PDF under 10 MB." };
  }

  if (!hasPdfExtension(args.fileName)) {
    return {
      ok: false,
      error: "That doesn't look like a valid PDF — please upload a .pdf file.",
    };
  }

  if (!isPdfMimeType(args.mimeType)) {
    return {
      ok: false,
      error: "That doesn't look like a valid PDF — please upload a .pdf file.",
    };
  }

  if (!hasPdfMagicBytes(args.bytes)) {
    return {
      ok: false,
      error: "That doesn't look like a valid PDF — the file may be corrupt.",
    };
  }

  return { ok: true };
}

export { MAX_UPLOAD_BYTES };
