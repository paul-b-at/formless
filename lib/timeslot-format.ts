const VIENNA_TZ = "Europe/Vienna";

export type LabeledOption = { label: string; value: string };

const dayKeyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIENNA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const slotLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIENNA_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTimeslotLabel(startTime: string): string {
  return slotLabelFormatter.format(new Date(startTime));
}

export function timeslotDayKey(startTime: string): string {
  return dayKeyFormatter.format(new Date(startTime));
}

const dayLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIENNA_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeOnlyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIENNA_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTimeslotDayLabel(startTime: string): string {
  return dayLabelFormatter.format(new Date(startTime));
}

export function formatTimeslotTimeOnly(startTime: string): string {
  return timeOnlyFormatter.format(new Date(startTime));
}

export type TimeslotDayGroup = {
  dayKey: string;
  dayLabel: string;
  options: LabeledOption[];
};

export function groupTimeslotOptionsByDay(
  options: LabeledOption[],
  slots: { id: string; startTime: string }[],
): TimeslotDayGroup[] {
  const groups: TimeslotDayGroup[] = [];
  const byKey = new Map<string, TimeslotDayGroup>();

  for (const option of options) {
    const slot = slots.find((entry) => entry.id === option.value);
    if (!slot) {
      continue;
    }
    const dayKey = timeslotDayKey(slot.startTime);
    let group = byKey.get(dayKey);
    if (!group) {
      group = {
        dayKey,
        dayLabel: formatTimeslotDayLabel(slot.startTime),
        options: [],
      };
      byKey.set(dayKey, group);
      groups.push(group);
    }
    group.options.push(option);
  }

  return groups;
}

export function buildTimeslotOptions(
  slots: { id: string; startTime: string }[],
): LabeledOption[] {
  const sorted = [...slots].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  return sorted.map((slot) => ({
    value: slot.id,
    label: formatTimeslotLabel(slot.startTime),
  }));
}
