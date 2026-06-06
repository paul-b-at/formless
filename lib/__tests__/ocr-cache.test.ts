import { afterEach, describe, expect, test } from "bun:test";

import {
  isOcrMockEnabled,
  ocrCacheKey,
  ocrCachePath,
  readOcrCache,
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
    expect(cached?.suggestedProductId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(cached?.extracted?.documentType).toBe("Power of Attorney");
    expect(ocrCachePath("nie-application-demo-joshua_timms.pdf")).toContain(
      ".ocr-cache/nie-application-demo-joshua_timms.json",
    );
  });

  test("readOcrCache returns null for unknown file", () => {
    expect(readOcrCache("does-not-exist.pdf")).toBeNull();
  });
});
