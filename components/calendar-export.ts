import { isTimeslotFallbackValue } from "@/lib/timeslot-fallback";

const CALENDAR_TIMEZONE = "Europe/Vienna";
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

export type CalendarEventInput = {
  timeslotValue: string;
  availableTimeslots?: { id: string; startTime: string }[];
  productName?: string;
  destinationCountry: string;
  countryLabel?: string;
  draftId?: string;
  referenceId?: string | null;
};

export type CalendarEventTiming =
  | { kind: "timed"; start: Date; end: Date }
  | { kind: "all-day"; date: string };

export type CalendarEvent = {
  title: string;
  description: string;
  uid: string;
  timing: CalendarEventTiming;
};

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function foldIcsLine(line: string): string {
  const max = 75;
  if (line.length <= max) {
    return line;
  }

  const chunks: string[] = [line.slice(0, max)];
  let index = max;
  while (index < line.length) {
    chunks.push(` ${line.slice(index, index + max - 1)}`);
    index += max - 1;
  }
  return chunks.join("\r\n");
}

function formatUtcStamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatViennaLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CALENDAR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return next.toISOString().slice(0, 10);
}

export function resolveCalendarTiming(
  timeslotValue: string,
  availableTimeslots?: { id: string; startTime: string }[],
): CalendarEventTiming {
  const trimmed = timeslotValue.trim();

  if (isTimeslotFallbackValue(trimmed)) {
    return { kind: "all-day", date: trimmed };
  }

  const slot = availableTimeslots?.find((entry) => entry.id === trimmed);
  if (slot) {
    const start = new Date(slot.startTime);
    return {
      kind: "timed",
      start,
      end: new Date(start.getTime() + DEFAULT_DURATION_MS),
    };
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const start = new Date(parsed);
    return {
      kind: "timed",
      start,
      end: new Date(start.getTime() + DEFAULT_DURATION_MS),
    };
  }

  return { kind: "all-day", date: trimmed };
}

export function buildCalendarEvent(input: CalendarEventInput): CalendarEvent {
  const productTitle = input.productName?.trim();
  const title = productTitle
    ? `${productTitle} · notarity`
    : "Notary appointment · notarity";

  const country = input.countryLabel?.trim() || input.destinationCountry;
  const descriptionParts = [
    `Destination: ${country}`,
    productTitle ? `Product: ${productTitle}` : null,
    input.draftId ? `Draft: ${input.draftId}` : null,
    input.referenceId ? `Reference: ${input.referenceId}` : null,
  ].filter((part): part is string => Boolean(part));

  const uidSeed =
    input.referenceId?.trim() ||
    input.draftId?.trim() ||
    input.timeslotValue.trim() ||
    "appointment";

  return {
    title,
    description: descriptionParts.join("\n"),
    uid: `notarity-${uidSeed}@formless.app`,
    timing: resolveCalendarTiming(
      input.timeslotValue,
      input.availableTimeslots,
    ),
  };
}

export function buildIcsContent(event: CalendarEvent): string {
  const now = formatUtcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//formless//notarity-booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.timing.kind === "all-day") {
    const startDate = event.timing.date.replace(/-/g, "");
    const endDate = addDaysToDateString(event.timing.date, 1).replace(/-/g, "");
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${endDate}`);
  } else {
    lines.push(
      `DTSTART;TZID=${CALENDAR_TIMEZONE}:${formatViennaLocal(event.timing.start)}`,
    );
    lines.push(
      `DTEND;TZID=${CALENDAR_TIMEZONE}:${formatViennaLocal(event.timing.end)}`,
    );
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  let dates: string;

  if (event.timing.kind === "all-day") {
    const startDate = event.timing.date.replace(/-/g, "");
    const endDate = addDaysToDateString(event.timing.date, 1).replace(/-/g, "");
    dates = `${startDate}/${endDate}`;
  } else {
    dates = `${formatUtcStamp(event.timing.start)}/${formatUtcStamp(event.timing.end)}`;
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    details: event.description,
    ctz: CALENDAR_TIMEZONE,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsBlob(event: CalendarEvent): Blob {
  return new Blob([buildIcsContent(event)], {
    type: "text/calendar;charset=utf-8",
  });
}

/** Same .ics payload as download — opens without forcing a file save (Calendar.app on Apple). */
export function openIcsInCalendarApp(event: CalendarEvent): void {
  const url = URL.createObjectURL(icsBlob(event));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One-shot calendar import URL for Apple devices. True webcal:// needs a hosted feed;
 * this reuses the same inline .ics so Calendar can open it directly when supported.
 */
export function buildIcsWebcalUrl(event: CalendarEvent): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcsContent(event))}`;
}

export function downloadIcsFile(event: CalendarEvent, filename = "notarity-appointment.ics"): void {
  const url = URL.createObjectURL(icsBlob(event));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
