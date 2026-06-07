import { afterEach, describe, expect, test } from "bun:test";

import {
  getOcrWritableCacheDir,
  isOcrMockEnabled,
  ocrCacheKey,
  ocrCachePath,
  readOcrCache,
  writeOcrCache,
} from "../ocr-cache";

describe("ocr-cache", () => {
  const previous = process.env.OCR_MOCK;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OCR_MOCK;
    } else {
      process.env.OCR_MOCK = previous;
    }
  });

  test("isOcrMockEnabled reads OCR_MOCK", () => {
    delete process.env.OCR_MOCK;
    expect(isOcrMockEnabled()).toBe(false);

    process.env.OCR_MOCK = "1";
    expect(isOcrMockEnabled()).toBe(true);

    process.env.OCR_MOCK = "true";
    expect(isOcrMockEnabled()).toBe(true);
  });

  test("ocrCacheKey strips extension from basename", () => {
    expect(ocrCacheKey("nie-application-demo-joshua_timms.pdf")).toBe(
      "nie-application-demo-joshua_timms",
    );
    expect(ocrCacheKey("/tmp/nie_personal_details.pdf")).toBe(
      "nie_personal_details",
    );
  });

  test("readOcrCache loads Joshua fixture", () => {
    const cached = readOcrCache("nie-application-demo-joshua_timms.pdf");
    expect(cached?.destinationCountry).toBe("ES");
    expect(cached?.productTitle).toBe("Nie number application");
    expect(cached?.productId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(cached?.suggestedProductId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(cached?.productConfidence).toBe("high");
    expect(cached?.extracted?.documentType).toBe("Power of Attorney");
    expect(ocrCachePath("nie-application-demo-joshua_timms.pdf")).toContain(
      ".ocr-cache/nie-application-demo-joshua_timms.json",
    );
  });

  test("readOcrCache returns null for unknown file", () => {
    expect(readOcrCache("does-not-exist.pdf")).toBeNull();
  });

  test("readOcrCache loads Robert fixture", () => {
    const cached = readOcrCache("Robert_Stevens_sample_case.pdf");
    expect(cached?.destinationCountry).toBe("LT");
    expect(cached?.productTitle).toBe("Signature notarisation");
    expect(cached?.productId).toBe("ujwBkZleJLPEzByCnPCS");
    expect(cached?.suggestedProductId).toBe("ujwBkZleJLPEzByCnPCS");
    expect(cached?.productConfidence).toBe("high");
    expect(cached?.extracted?.documentType).toBe("Special Power of Attorney");
  });

  test("readOcrCache loads Elizabeth fixture", () => {
    const cached = readOcrCache("Gesellschaftsvertrag_Midgley_Tech_EU_FlexCo.pdf");
    expect(cached?.destinationCountry).toBe("AT");
    expect(cached?.productId).toBe("S3N2zyJENFE0vTjrKTZn");
    expect(cached?.productConfidence).toBe("high");
  });

  test("getOcrWritableCacheDir uses /tmp on Vercel", () => {
    const previousVercel = process.env.VERCEL;
    const previousCacheDir = process.env.OCR_CACHE_DIR;
    delete process.env.OCR_CACHE_DIR;
    process.env.VERCEL = "1";
    expect(getOcrWritableCacheDir()).toContain("formless-ocr-cache");
    delete process.env.VERCEL;
    expect(getOcrWritableCacheDir()).toContain(".ocr-cache");
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
    if (previousCacheDir === undefined) {
      delete process.env.OCR_CACHE_DIR;
    } else {
      process.env.OCR_CACHE_DIR = previousCacheDir;
    }
  });

  test("writeOcrCache never throws on read-only parent", () => {
    const previousCacheDir = process.env.OCR_CACHE_DIR;
    process.env.OCR_CACHE_DIR = "/nonexistent-readonly-path/formless-ocr";
    expect(
      writeOcrCache("test.pdf", {
        destinationCountry: "ES",
        confidence: "high",
      }),
    ).toBeNull();
    if (previousCacheDir === undefined) {
      delete process.env.OCR_CACHE_DIR;
    } else {
      process.env.OCR_CACHE_DIR = previousCacheDir;
    }
  });
});
