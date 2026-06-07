import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatOcrSummary } from "../ocr-summary";
import { normalizeOcrResponse } from "../ocr-types";

describe("formatOcrSummary", () => {
  test("Joshua NIE PoA shows purpose mapping, not bare document type", () => {
    const raw = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          ".ocr-cache/nie-application-demo-joshua_timms.json",
        ),
        "utf8",
      ),
    );
    const ocr = normalizeOcrResponse(raw);
    const summary = formatOcrSummary(
      ocr,
      "nie-application-demo-joshua_timms.pdf",
    );

    expect(summary).toContain(
      "Detected: Power of Attorney → suggested Nie number application",
    );
    expect(summary).not.toContain("(document type:");
    expect(summary).not.toContain("Best match: Nie number application");
  });
});
