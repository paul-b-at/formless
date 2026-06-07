import { describe, expect, test } from "bun:test";

import { buildPriceDisplay } from "../price-display";
import type { PriceLineItem } from "../notarity";

describe("buildPriceDisplay", () => {
  test("reads explicit tax fields when present", () => {
    const items = [
      {
        name: "Service",
        amount: 1,
        pricePerUnit: 55000,
        net: 55000,
        identifier: 1,
        tax: 11000,
        gross: 66000,
      },
    ] as PriceLineItem[];

    const display = buildPriceDisplay(items);
    expect(display.taxTotalCents).toBe(11000);
    expect(display.grossTotalCents).toBe(66000);
    expect(display.netTotalCents).toBe(55000);
    expect(display.vatSource).toBe("api");
  });

  test("falls back to net when API has no tax fields", () => {
    const items: PriceLineItem[] = [
      {
        name: "Hard Copy (including shipping)",
        amount: 1,
        pricePerUnit: 3000,
        net: 3000,
        identifier: 3,
      },
    ];

    const display = buildPriceDisplay(items);
    expect(display.taxTotalCents).toBe(0);
    expect(display.grossTotalCents).toBe(3000);
    expect(display.vatSource).toBe("net-only");
    expect(display.vatNote).toContain("net-only");
  });
});
