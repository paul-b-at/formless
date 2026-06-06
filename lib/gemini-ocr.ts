import { GoogleGenAI } from "@google/genai";

export const OCR_READ_FAILED_NOTICE =
  "I couldn't read much from that document — let's fill it in together.";

/** Ordered OCR model chain — primary first, fall back on transient errors only. */
export function getOcrModels(): string[] {
  return (
    process.env.OCR_MODELS ??
    "gemini-3.5-flash,gemini-3.0-flash,gemini-2.5-flash,gemini-2.0-flash"
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.status === "number") {
    return record.status;
  }
  if (typeof record.statusCode === "number") {
    return record.statusCode;
  }
  const response = record.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") {
    return response.status;
  }
  return undefined;
}

export function describeGeminiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Rate limits, server errors, and network faults — retry with the next model. */
export function isTransientGeminiError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429) {
    return true;
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return true;
  }

  const message = describeGeminiError(error).toLowerCase();
  const name =
    error instanceof Error ? error.name.toLowerCase() : "";

  if (
    name.includes("timeout") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("socket hang up")
  ) {
    return true;
  }

  return (
    message.includes("429") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500") ||
    message.includes("internal error")
  );
}

export type GenerateContentRequest = Parameters<
  GoogleGenAI["models"]["generateContent"]
>[0];

export type OcrGenerateResult =
  | { ok: true; text: string | undefined; model: string }
  | { ok: false; notice: string };

/**
 * Call generateContent with OCR_MODELS fallback.
 * Transient errors try the next model; non-transient errors stop immediately.
 */
export async function generateContentWithOcrFallback(
  ai: GoogleGenAI,
  request: Omit<GenerateContentRequest, "model">,
): Promise<OcrGenerateResult> {
  const models = getOcrModels();
  if (models.length === 0) {
    return { ok: false, notice: OCR_READ_FAILED_NOTICE };
  }

  let lastTransient: unknown;

  for (let index = 0; index < models.length; index++) {
    const model = models[index]!;
    try {
      const response = await ai.models.generateContent({
        ...request,
        model,
      });
      return { ok: true, text: response.text, model };
    } catch (error) {
      if (!isTransientGeminiError(error)) {
        console.error(
          `OCR model ${model} failed (non-transient): ${describeGeminiError(error)}`,
        );
        return { ok: false, notice: OCR_READ_FAILED_NOTICE };
      }

      console.warn(
        `OCR model ${model} failed (transient): ${describeGeminiError(error)}`,
      );
      lastTransient = error;
    }
  }

  console.warn(
    `All OCR models exhausted (${models.join(" → ")}): ${describeGeminiError(lastTransient)}`,
  );
  return { ok: false, notice: OCR_READ_FAILED_NOTICE };
}
