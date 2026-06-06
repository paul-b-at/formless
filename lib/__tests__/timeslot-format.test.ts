import { describe, expect, test } from "bun:test";

import {
  buildTimeslotOptions,
  formatTimeslotLabel,
  groupTimeslotOptionsByDay,
} from "../timeslot-format";

describe("formatTimeslotLabel", () => {
  test("formats UTC slot in Europe/Vienna", () => {
    const label = formatTimeslotLabel("2026-06-08T06:00:00.000Z");
    expect(label).toContain("08:00");
    expect(label).toMatch(/Mon|8 Jun/i);
  });
});

describe("buildTimeslotOptions", () => {
  test("keeps id as value and friendly label for display", () => {
    const options = buildTimeslotOptions([
      { id: "slot-b", startTime: "2026-06-08T06:10:00.000Z" },
      { id: "slot-a", startTime: "2026-06-08T06:00:00.000Z" },
    ]);

    expect(options[0]?.value).toBe("slot-a");
    expect(options[0]?.label).toContain("08:00");
    expect(options[1]?.value).toBe("slot-b");
  });
});

describe("groupTimeslotOptionsByDay", () => {
  test("groups options by Vienna calendar day", () => {
    const slots = [
      { id: "a", startTime: "2026-06-08T06:00:00.000Z" },
      { id: "b", startTime: "2026-06-08T06:10:00.000Z" },
      { id: "c", startTime: "2026-06-09T06:00:00.000Z" },
    ];
    const options = buildTimeslotOptions(slots);
    const groups = groupTimeslotOptionsByDay(options, slots);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.options).toHaveLength(2);
    expect(groups[1]?.options).toHaveLength(1);
    expect(groups[0]?.options[0]?.value).toBe("a");
  });
});
