import { describe, expect, test } from "bun:test";

import {
  exactOptionValue,
  isResolvedExtraction,
} from "../answer-resolution";

describe("answer-resolution", () => {
  test("exactOptionValue matches quick-reply value", () => {
    const value = exactOptionValue("Spain (ES)", [
      { label: "Spain (ES)", value: "Spain (ES)" },
      { label: "Austria (AT)", value: "Austria (AT)" },
    ]);
    expect(value).toBe("Spain (ES)");
  });

  test("isResolvedExtraction accepts ISO country code", () => {
    expect(
      isResolvedExtraction(
        { id: "c", type: "countryPicker", accessor: "destinationCountry" },
        "Spain (ES)",
        "ES",
        [],
        [],
      ),
    ).toBe(true);
  });

  test("isResolvedExtraction rejects echo of unresolved free text", () => {
    expect(
      isResolvedExtraction(
        { id: "p", type: "productPicker", accessor: "products" },
        "something random",
        "something random",
        [],
        [],
      ),
    ).toBe(false);
  });
});
