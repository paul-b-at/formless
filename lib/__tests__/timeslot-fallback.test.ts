import { describe, expect, test } from "bun:test";

import {
  dateToTimeslotPayloadValue,
  isTimeslotFallbackValue,
  parseTimeslotDateAnswer,
  TIMESLOT_DATE_PAYLOAD_FORMAT,
} from "../timeslot-fallback";

describe("timeslot-fallback", () => {
  test("maps YYYY-MM-DD to date-only timeslots[] value", () => {
    expect(dateToTimeslotPayloadValue("2026-06-08")).toBe("2026-06-08");
  });

  test("maps ISO datetime to date-only payload value", () => {
    expect(dateToTimeslotPayloadValue("2026-06-08T09:00:00.000Z")).toBe(
      "2026-06-08",
    );
  });

  test("detects fallback payload values", () => {
    expect(isTimeslotFallbackValue("2026-06-08")).toBe(true);
    expect(isTimeslotFallbackValue("iiCQHiAzdfvEwx1gshtp")).toBe(false);
  });

  test("parses chat date answers", () => {
    expect(parseTimeslotDateAnswer("2026-06-09")).toBe("2026-06-09");
    expect(parseTimeslotDateAnswer("not a date")).toBeNull();
  });

  test("documents payload mapping format", () => {
    expect(TIMESLOT_DATE_PAYLOAD_FORMAT).toContain("timeslots[]");
  });
});
