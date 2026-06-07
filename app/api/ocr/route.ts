import { NextResponse } from "next/server";

import { isOcrMockEnabled, writeOcrCache } from "@/lib/ocr-cache";
import { inferFromDocument } from "@/lib/ocr-inference";
import { validatePdfUpload } from "@/lib/upload-validation";

export const runtime = "nodejs";

function mimeFromName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  return undefined;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Missing file upload (field name: file)" },
        { status: 400 },
      );
    }

    const mimeType =
      (file.type?.trim().toLowerCase() === "application/pdf"
        ? "application/pdf"
        : undefined) ?? mimeFromName(file.name);

    const bytes = Buffer.from(await file.arrayBuffer());
    const validation = validatePdfUpload({
      bytes,
      fileName: file.name,
      mimeType,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const result = await inferFromDocument({
      bytes,
      mimeType: "application/pdf",
      fileName: file.name,
    });

    if (!isOcrMockEnabled() && !result.notice) {
      // Best-effort dev cache — never fail the request (Vercel FS is read-only except /tmp).
      writeOcrCache(file.name, result);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("OCR route error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        notice:
          "I couldn't read much from that document — let's fill it in together.",
      },
      { status: 200 },
    );
  }
}
