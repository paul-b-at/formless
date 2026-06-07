import { describe, expect, test } from "bun:test";

import { parseHardCopyAnswer } from "../hard-copy-options";

describe("hard-copy-options", () => {
  test("parses express hard copy combo", () => {
    expect(
      parseHardCopyAnswer("Yes, send a hard copy with express shipping"),
    ).toEqual({ hardCopy: true, expressShipping: true });
  });

  test("parses standard hard copy", () => {
    expect(parseHardCopyAnswer("Yes, send a hard copy")).toEqual({
      hardCopy: true,
      expressShipping: false,
    });
  });

  test("parses no hard copy", () => {
    expect(parseHardCopyAnswer("No hard copy needed")).toEqual({
      hardCopy: false,
      expressShipping: false,
    });
  });

  test("legacy express-only phrase still parses if typed", () => {
    expect(parseHardCopyAnswer("Express shipping only, no hard copy")).toEqual({
      hardCopy: false,
      expressShipping: true,
    });
  });
});
