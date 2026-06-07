import { describe, expect, test } from "bun:test";

import { rankOcrCountrySuggestions } from "../../components/ocr-country-suggestions";

const supported = [
  { code: "AT", label: "Austria" },
  { code: "ES", label: "Spain" },
  { code: "LT", label: "Lithuania" },
  { code: "DE", label: "Germany" },
];

describe("rankOcrCountrySuggestions", () => {
  test("puts detected supported country first and caps at three", () => {
    const ranked = rankOcrCountrySuggestions(supported, "LT", "Lithuania");
    expect(ranked.map((country) => country.code)).toEqual(["LT", "AT", "DE"]);
  });

  test("returns top supported picks when detected country is unsupported", () => {
    const ranked = rankOcrCountrySuggestions(supported, "US", "United States");
    expect(ranked).toHaveLength(3);
    expect(ranked.every((country) => supported.some((s) => s.code === country.code))).toBe(
      true,
    );
  });
});
