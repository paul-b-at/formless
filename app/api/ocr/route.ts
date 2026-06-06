import { NextResponse } from "next/server";

import { inferFromDocument } from "@/lib/ocr-inference";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function mimeFromName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
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
      (file.type && ALLOWED_TYPES.has(file.type) ? file.type : undefined) ??
      mimeFromName(file.name);

    if (!mimeType || !ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF or image." },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await inferFromDocument({
      bytes,
      mimeType,
      fileName: file.name,
    });

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
