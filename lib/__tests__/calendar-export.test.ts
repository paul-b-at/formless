import { describe, expect, test } from "bun:test";

import {
  buildCalendarEvent,
  buildGoogleCalendarUrl,
  buildIcsContent,
  resolveCalendarTiming,
} from "@/components/calendar-export";

describe("resolveCalendarTiming", () => {
  test("treats YYYY-MM-DD payload as all-day", () => {
    expect(resolveCalendarTiming("2026-06-10")).toEqual({
      kind: "all-day",
      date: "2026-06-10",
    });
  });

  test("resolves real slot id to timed event with 30 min duration", () => {
    const timing = resolveCalendarTiming("slot-a", [
      { id: "slot-a", startTime: "2026-06-08T06:00:00.000Z" },
    ]);

    expect(timing.kind).toBe("timed");
    if (timing.kind === "timed") {
      expect(timing.end.getTime() - timing.start.getTime()).toBe(30 * 60 * 1000);
    }
  });
});

describe("buildCalendarEvent", () => {
  test("builds title, description, and stable uid", () => {
    const event = buildCalendarEvent({
      timeslotValue: "slot-a",
      availableTimeslots: [
        { id: "slot-a", startTime: "2026-06-08T06:00:00.000Z" },
      ],
      productName: "NIE Application",
      destinationCountry: "ES",
      countryLabel: "🇪🇸 Spain",
      draftId: "draft-123",
      referenceId: "req-456",
    });

    expect(event.title).toBe("NIE Application · notarity");
    expect(event.description).toContain("Destination: 🇪🇸 Spain");
    expect(event.description).toContain("Product: NIE Application");
    expect(event.description).toContain("Draft: draft-123");
    expect(event.description).toContain("Reference: req-456");
    expect(event.uid).toBe("notarity-req-456@formless.app");
  });
});

describe("calendar export formats", () => {
  test("ics contains VEVENT fields", () => {
    const event = buildCalendarEvent({
      timeslotValue: "2026-06-10",
      productName: "FlexCo",
      destinationCountry: "AT",
      draftId: "draft-abc",
    });
    const ics = buildIcsContent(event);

    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:FlexCo · notarity");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260610");
    expect(ics).toContain("DTEND;VALUE=DATE:20260611");
    expect(ics).toContain("UID:notarity-draft-abc@formless.app");
  });

  test("google url uses UTC dates for timed slots", () => {
    const event = buildCalendarEvent({
      timeslotValue: "slot-a",
      availableTimeslots: [
        { id: "slot-a", startTime: "2026-06-08T06:00:00.000Z" },
      ],
      destinationCountry: "ES",
    });
    const url = buildGoogleCalendarUrl(event);

    expect(url).toContain("calendar.google.com/calendar/render");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260608T060000Z%2F20260608T063000Z");
    expect(url).toContain("ctz=Europe%2FVienna");
  });
});
