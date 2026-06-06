import { describe, expect, test } from "bun:test";

import {
  describeGeminiError,
  getOcrModels,
  isTransientGeminiError,
  OCR_READ_FAILED_NOTICE,
} from "../gemini-ocr";

describe("gemini-ocr", () => {
  test("getOcrModels uses defaults when env unset", () => {
    const previous = process.env.OCR_MODELS;
    delete process.env.OCR_MODELS;

    expect(getOcrModels()).toEqual([
      "gemini-3.5-flash",
      "gemini-3.0-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ]);

    if (previous !== undefined) {
      process.env.OCR_MODELS = previous;
    }
  });

  test("getOcrModels parses comma-separated env", () => {
    const previous = process.env.OCR_MODELS;
    process.env.OCR_MODELS = " model-a , model-b ";

    expect(getOcrModels()).toEqual(["model-a", "model-b"]);

    if (previous !== undefined) {
      process.env.OCR_MODELS = previous;
    } else {
      delete process.env.OCR_MODELS;
    }
  });

  test("isTransientGeminiError detects 429 and 5xx", () => {
    expect(isTransientGeminiError({ status: 429 })).toBe(true);
    expect(isTransientGeminiError({ status: 503 })).toBe(true);
    expect(isTransientGeminiError(new Error("RESOURCE_EXHAUSTED quota"))).toBe(
      true,
    );
    expect(isTransientGeminiError(new Error("fetch failed"))).toBe(true);
  });

  test("isTransientGeminiError rejects 400 malformed requests", () => {
    expect(isTransientGeminiError({ status: 400 })).toBe(false);
    expect(isTransientGeminiError(new Error("Invalid argument"))).toBe(false);
  });

  test("describeGeminiError reads Error messages", () => {
    expect(describeGeminiError(new Error("rate limit"))).toBe("rate limit");
    expect(OCR_READ_FAILED_NOTICE).toContain("couldn't read");
  });
});
