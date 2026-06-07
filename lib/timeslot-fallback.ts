import { getTimeslotLabel, type BookingFormSchema, type Collected } from "./form-interpreter";
import { getTimeslots } from "./notarity";

export type TimeslotSlot = { id: string; startTime: string };

export type TimeslotLoadResult = {
  slots: TimeslotSlot[];
  /** When true, UI should collect a date and map it into timeslots[]. */
  fallback: boolean;
  reason?: "fetch_error" | "empty" | "no_label" | "mock";
};

/** Verified against POST /appointment-requests/price — accepts YYYY-MM-DD in timeslots[]. */
export const TIMESLOT_DATE_PAYLOAD_FORMAT =
  "YYYY-MM-DD (date-only string in timeslots[])";

/**
 * Map a user-selected calendar date to the appointment-request timeslots[] value.
 * The staging price endpoint accepts this date-only form (see contract probe).
 */
export function dateToTimeslotPayloadValue(dateInput: string): string {
  const trimmed = dateInput.trim();

  const isoDateTime = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  );
  if (isoDateTime) {
    return isoDateTime[1]!;
  }

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    return dateOnly[1]!;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  throw new Error(`Could not parse appointment date: ${dateInput}`);
}

export function isTimeslotFallbackValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function formatTimeslotPayloadDisplay(
  value: string,
  slots: TimeslotSlot[] = [],
): string {
  const slot = slots.find((entry) => entry.id === value);
  if (slot) {
    return slot.startTime;
  }
  if (isTimeslotFallbackValue(value)) {
    return `${value} (preferred date — timeslot API unavailable)`;
  }
  return value;
}

function searchWindow(): { startDate: string; endDate: string } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export async function loadTimeslotsResilient(
  form: BookingFormSchema,
  collected: Collected,
): Promise<TimeslotLoadResult> {
  if (process.env.TIMESLOT_FETCH_MOCK === "fail") {
    console.warn(
      "[timeslots] TIMESLOT_FETCH_MOCK=fail — using date fallback for demo",
    );
    return { slots: [], fallback: true, reason: "mock" };
  }

  const label = getTimeslotLabel(form, collected);
  if (!label) {
    console.warn(
      "[timeslots] No timeslot label in form config — using date fallback",
    );
    return { slots: [], fallback: true, reason: "no_label" };
  }

  const { startDate, endDate } = searchWindow();

  try {
    const raw = await getTimeslots({
      timeslotLabel: label,
      startDate,
      endDate,
    });
    const slots = raw
      .filter((slot) => slot.available > 0)
      .map((slot) => ({ id: slot.id, startTime: slot.startTime }));

    if (slots.length === 0) {
      console.warn(
        "[timeslots] Fetch returned no available slots — using date fallback",
      );
      return { slots: [], fallback: true, reason: "empty" };
    }

    return { slots, fallback: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[timeslots] Fetch failed (${message}) — using date fallback; payload will use ${TIMESLOT_DATE_PAYLOAD_FORMAT}`,
    );
    return { slots: [], fallback: true, reason: "fetch_error" };
  }
}

export function parseTimeslotDateAnswer(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return dateToTimeslotPayloadValue(trimmed);
  } catch {
    return null;
  }
}

export function fallbackDateBounds(): { min: string; max: string } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 30);
  return {
    min: start.toISOString().slice(0, 10),
    max: end.toISOString().slice(0, 10),
  };
}
