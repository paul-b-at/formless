import type { AppointmentRequest } from "./booking-schema";
import type { BookingFormSchema, Collected, Component } from "./form-interpreter";
import { isUploadFileName } from "./form-interpreter";
import { isValidEmail } from "./field-validation";

export type ParticipantRow = {
  email: string;
  client: boolean;
  supervisor: boolean;
};

export type ParticipantSetup = {
  minParticipants: number;
  maxParticipants: number;
  title: string;
};

export type ParticipantCollectedMeta = {
  participantsExpectMore?: boolean;
  participantsFinalized?: boolean;
};

export type CollectedWithParticipantMeta = Collected & ParticipantCollectedMeta;

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 10;

const CONTINUE_PHRASES = [
  /^continue$/i,
  /^that'?s all$/i,
  /^done$/i,
  /^no more$/i,
  /^finish$/i,
  /^proceed$/i,
];

const ADD_ANOTHER_PHRASES = [
  /add another signer/i,
  /another signer/i,
  /add another participant/i,
  /add one more/i,
  /one more signer/i,
];

export function findParticipantsComponent(
  form: BookingFormSchema,
): Component | null {
  function walk(components: Component[]): Component | null {
    for (const component of components) {
      if (component.type === "condition") {
        const inThen = walk(component.props?.components ?? []);
        if (inThen) {
          return inThen;
        }
        const inElse = walk(component.props?.elseComponents ?? []);
        if (inElse) {
          return inElse;
        }
        continue;
      }
      const accessor = component.accessor ?? component.type;
      if (accessor === "participants" || component.type === "participants") {
        return component;
      }
    }
    return null;
  }

  for (const page of form.pages) {
    const found = walk(page.components);
    if (found) {
      return found;
    }
  }
  return null;
}

function readNumericProp(
  props: Record<string, unknown> | undefined,
  keys: string[],
  fallback: number,
): number {
  if (!props) {
    return fallback;
  }
  for (const key of keys) {
    const raw = props[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(0, Math.floor(raw));
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
      }
    }
  }
  return fallback;
}

export function getParticipantSetup(component: Component): ParticipantSetup {
  const props = (component.props ?? {}) as Record<string, unknown>;
  const minParticipants = readNumericProp(
    props,
    ["minParticipants", "min", "minimum"],
    DEFAULT_MIN,
  );
  const maxRaw = readNumericProp(
    props,
    ["maxParticipants", "max", "maximum"],
    DEFAULT_MAX,
  );
  const maxParticipants = Math.max(minParticipants, maxRaw);
  const label =
    component.label?.en ??
    component.label?.de ??
    "Who will participate in the appointment?";

  return {
    minParticipants: Math.max(1, minParticipants),
    maxParticipants,
    title: label,
  };
}

export function defaultParticipantRow(email: string): ParticipantRow {
  return { email: email.trim(), client: true, supervisor: false };
}

export function normalizedRows(
  participants: AppointmentRequest["participants"] | undefined,
): ParticipantRow[] {
  if (!participants?.length) {
    return [];
  }
  return participants.map((row) => ({
    email: row.email.trim(),
    client: row.client,
    supervisor: row.supervisor,
  }));
}

export function isSingleChatFinalized(
  collected: CollectedWithParticipantMeta,
  setup: ParticipantSetup,
): boolean {
  const rows = normalizedRows(collected.participants);
  if (rows.length === 0) {
    return false;
  }
  if (collected.participantsFinalized === true) {
    return true;
  }
  if (collected.participantsExpectMore === true) {
    return false;
  }
  if (rows.length === 1 && setup.minParticipants <= 1) {
    return true;
  }
  return rows.length >= setup.minParticipants && rows.length <= setup.maxParticipants;
}

export function isParticipantsFilled(
  collected: CollectedWithParticipantMeta,
  setup: ParticipantSetup,
): boolean {
  const rows = normalizedRows(collected.participants);
  const validRows = rows.filter((row) => isValidEmail(row.email));

  if (validRows.length < setup.minParticipants) {
    return false;
  }

  if (collected.participantsExpectMore === true) {
    return false;
  }

  if (collected.participantsFinalized === true) {
    return validRows.length >= setup.minParticipants;
  }

  return isSingleChatFinalized(collected, setup);
}

export function stripParticipantMeta(
  collected: CollectedWithParticipantMeta,
): Collected {
  const next = { ...collected };
  delete next.participantsExpectMore;
  delete next.participantsFinalized;
  return next;
}

export function mergeParticipantRows(
  existing: ParticipantRow[],
  incoming: ParticipantRow[],
): ParticipantRow[] {
  const seen = new Set<string>();
  const merged: ParticipantRow[] = [];

  for (const row of [...existing, ...incoming]) {
    const email = row.email.trim().toLowerCase();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    merged.push({
      email: row.email.trim(),
      client: row.client,
      supervisor: row.supervisor,
    });
  }

  return merged;
}

export function validateParticipantRows(
  rows: ParticipantRow[],
  setup: ParticipantSetup,
): { ok: true } | { ok: false; message: string } {
  if (rows.length < setup.minParticipants) {
    return {
      ok: false,
      message: `Please add at least ${setup.minParticipants} participant email${setup.minParticipants === 1 ? "" : "s"}.`,
    };
  }

  if (rows.length > setup.maxParticipants) {
    return {
      ok: false,
      message: `You can add at most ${setup.maxParticipants} participants.`,
    };
  }

  for (const row of rows) {
    const email = row.email.trim();
    if (isUploadFileName(email)) {
      return {
        ok: false,
        message:
          "That looks like a filename, not an email. Please enter an email address.",
      };
    }
    if (!isValidEmail(email)) {
      return {
        ok: false,
        message:
          "That doesn't look like a valid email address. Please try again.",
      };
    }
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    if (seen.has(key)) {
      return {
        ok: false,
        message: "Each participant needs a unique email address.",
      };
    }
    seen.add(key);
  }

  return { ok: true };
}

export type ParticipantsStructuredAnswer = {
  participants: ParticipantRow[];
  finalize?: boolean;
  expectMore?: boolean;
};

export function parseParticipantsStructuredAnswer(
  structuredAnswer: Record<string, unknown>,
  existing: ParticipantRow[],
  setup: ParticipantSetup,
): {
  rows: ParticipantRow[];
  expectMore: boolean;
  finalized: boolean;
} {
  const rawRows = structuredAnswer.participants;
  const parsedIncoming: ParticipantRow[] = Array.isArray(rawRows)
    ? rawRows
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const row = entry as Record<string, unknown>;
          const email =
            typeof row.email === "string" ? row.email.trim() : "";
          if (!email) {
            return null;
          }
          return {
            email,
            client: row.client !== false,
            supervisor: row.supervisor === true,
          };
        })
        .filter((row): row is ParticipantRow => row !== null)
    : [];

  const finalize =
    structuredAnswer.finalize === true ||
    structuredAnswer.participantsFinalized === true;
  const expectMore =
    structuredAnswer.expectMore === true ||
    structuredAnswer.participantsExpectMore === true;

  const rows =
    parsedIncoming.length > 0
      ? mergeParticipantRows(existing, parsedIncoming)
      : existing;

  const finalized =
    finalize ||
    (!expectMore && rows.length >= setup.minParticipants && rows.length > 0);

  return {
    rows,
    expectMore: expectMore && !finalize,
    finalized,
  };
}

export type ParticipantsChatAction =
  | { type: "finalize" }
  | { type: "expectMore" }
  | { type: "append"; email: string }
  | { type: "replace"; rows: ParticipantRow[] };

export function parseParticipantsChatMessage(
  message: string,
): ParticipantsChatAction | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  if (CONTINUE_PHRASES.some((pattern) => pattern.test(trimmed))) {
    return { type: "finalize" };
  }

  if (ADD_ANOTHER_PHRASES.some((pattern) => pattern.test(trimmed))) {
    return { type: "expectMore" };
  }

  if (isValidEmail(trimmed) && !isUploadFileName(trimmed)) {
    return { type: "append", email: trimmed };
  }

  return null;
}

export function applyParticipantsChatAction(
  collected: CollectedWithParticipantMeta,
  action: ParticipantsChatAction,
  setup: ParticipantSetup,
): CollectedWithParticipantMeta {
  const existing = normalizedRows(collected.participants);

  if (action.type === "expectMore") {
    return {
      ...collected,
      participantsExpectMore: true,
      participantsFinalized: false,
    };
  }

  if (action.type === "finalize") {
    return {
      ...collected,
      participantsExpectMore: false,
      participantsFinalized: true,
    };
  }

  if (action.type === "append") {
    const rows = mergeParticipantRows(existing, [
      defaultParticipantRow(action.email),
    ]);
    const atMax = rows.length >= setup.maxParticipants;
    return {
      ...collected,
      participants: rows,
      participantsExpectMore: atMax ? false : collected.participantsExpectMore,
      participantsFinalized:
        atMax || (!collected.participantsExpectMore && rows.length >= setup.minParticipants),
    };
  }

  return {
    ...collected,
    participants: action.rows,
    participantsExpectMore: false,
    participantsFinalized: action.rows.length >= setup.minParticipants,
  };
}

export function participantsToCollectedValue(
  parsed: ReturnType<typeof parseParticipantsStructuredAnswer>,
): CollectedWithParticipantMeta {
  return {
    participants: parsed.rows,
    participantsExpectMore: parsed.expectMore,
    participantsFinalized: parsed.finalized,
  };
}
