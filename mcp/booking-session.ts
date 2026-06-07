import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  AppointmentRequest,
  type AppointmentRequest as AppointmentRequestType,
} from "../lib/booking-schema";
import { advance, type EngineState, type EngineStep } from "../lib/engine";
import { parseBookingForm } from "../lib/form-interpreter";
import {
  getBookingForm,
  priceRequest,
  submitRequest,
  sumNetToEuros,
} from "../lib/notarity";

export const DEFAULT_SLUG = "start-vienna-hackathon";
export const REFERENCE_FILES_DIR = "notarity-reference";
export const DEBUG_DRAFT_ID = "vfniS9nfoq8nMpRqQj7Z";

const sessions = new Map<string, EngineState>();

export type SessionSummary = {
  sessionId: string;
  collectedFields: string[];
  missingFields: string[];
  complete: boolean;
  confirmedPrice?: number;
  lastAssistantMessage?: string;
};

export type AnswerInput = {
  sessionId: string;
  userMessage: string;
  structuredAnswer?: Record<string, unknown>;
  uploadProductId?: string;
  uploadKind?: "file";
};

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "payload";
    return `${path}: ${issue.message}`;
  });
}

export function summarizeSession(
  sessionId: string,
  state: EngineState,
  step?: EngineStep,
): SessionSummary {
  const collected = state.collected;
  const collectedFields = Object.keys(collected).sort();
  const missingFields =
    step?.type === "ask"
      ? [step.accessor]
      : step?.type === "fileUpload"
        ? [`products:${step.productId}`]
        : step?.type === "form"
          ? [step.accessor]
          : [];

  const lastAssistantMessage =
    step?.type === "ask" || step?.type === "fileUpload"
      ? step.question
      : step?.type === "form"
        ? step.error ?? step.title
        : state.messages.at(-1)?.role === "assistant"
          ? state.messages.at(-1)?.content
          : undefined;

  return {
    sessionId,
    collectedFields,
    missingFields,
    complete: step?.type === "complete",
    confirmedPrice:
      typeof collected.confirmedPrice === "number"
        ? collected.confirmedPrice
        : state.pricing?.euroTotal,
    lastAssistantMessage,
  };
}

export function formatStepText(
  step: EngineStep,
  summary: SessionSummary,
): string {
  if (step.type === "complete") {
    return [
      "The booking payload is complete.",
      `Confirmed price: €${step.payload.confirmedPrice}`,
      `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
      "Use get_price before submit_booking.",
    ].join("\n");
  }

  if (step.type === "fileUpload") {
    return [
      step.question,
      `Product: ${step.productLabel} (${step.productId})`,
      "",
      `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
      `Missing fields: ${summary.missingFields.join(", ") || "none"}`,
      `Complete: ${summary.complete ? "yes" : "no"}`,
    ].join("\n");
  }

  if (step.type === "form") {
    return [
      step.title,
      step.error ?? "",
      "",
      `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
      `Missing fields: ${summary.missingFields.join(", ") || "none"}`,
      `Complete: ${summary.complete ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (step.type === "participants" || step.type === "datePicker") {
    return [
      step.title,
      step.error ?? "",
      "",
      `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
      `Missing fields: ${summary.missingFields.join(", ") || "none"}`,
      `Complete: ${summary.complete ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    step.question,
    "",
    `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
    `Missing fields: ${summary.missingFields.join(", ") || "none"}`,
    `Complete: ${summary.complete ? "yes" : "no"}`,
  ].join("\n");
}

function getSession(sessionId: string): EngineState {
  const state = sessions.get(sessionId);
  if (!state) {
    throw new Error(`Unknown booking session: ${sessionId}`);
  }
  return state;
}

function buildPayloadForPricing(state: EngineState) {
  const parsed = AppointmentRequest.safeParse({
    ...state.collected,
    confirmedPrice: state.collected.confirmedPrice ?? 0,
  });

  if (!parsed.success) {
    return { ok: false as const, issues: zodIssues(parsed.error) };
  }

  return { ok: true as const, payload: parsed.data };
}

async function getUploadedFiles(state: EngineState) {
  const fileNames =
    state.collected.products?.flatMap((product) => product.files) ?? [];
  const uniqueFileNames = [...new Set(fileNames)];

  return Promise.all(
    uniqueFileNames.map(async (name) => ({
      name,
      data: await readFile(join(process.cwd(), REFERENCE_FILES_DIR, name)),
    })),
  );
}

function debugPayload(
  payload: AppointmentRequestType,
  euroTotal: number,
): AppointmentRequestType {
  return AppointmentRequest.parse({
    ...payload,
    mode: "debug",
    _appointmentRequestDraft:
      payload._appointmentRequestDraft ?? DEBUG_DRAFT_ID,
    confirmedPrice: euroTotal,
  });
}

export async function startBooking(slug?: string): Promise<{
  sessionId: string;
  state: EngineState;
  step: EngineStep;
  summary: SessionSummary;
  text: string;
}> {
  const rawForm = await getBookingForm(slug ?? DEFAULT_SLUG);
  const form = parseBookingForm(rawForm);
  const sessionId = randomUUID();
  const initialState: EngineState = {
    form,
    collected: {},
    messages: [],
  };

  const { state, step } = await advance(initialState, "");
  sessions.set(sessionId, state);

  const summary = summarizeSession(sessionId, state, step);
  const text =
    step.type === "ask" || step.type === "fileUpload" || step.type === "form"
      ? `Started booking session ${sessionId}.\n\n${formatStepText(step, summary)}`
      : step.type === "complete"
        ? `Started booking session ${sessionId}. The booking payload is complete.`
        : `Started booking session ${sessionId}.`;

  return { sessionId, state, step, summary, text };
}

export async function answerBooking(input: AnswerInput): Promise<{
  state: EngineState;
  step: EngineStep;
  summary: SessionSummary;
  text: string;
}> {
  const state = getSession(input.sessionId);
  const result = await advance(
    state,
    input.userMessage,
    input.structuredAnswer,
    input.uploadProductId,
    input.uploadKind,
  );
  sessions.set(input.sessionId, result.state);

  const summary = summarizeSession(input.sessionId, result.state, result.step);
  return {
    state: result.state,
    step: result.step,
    summary,
    text: formatStepText(result.step, summary),
  };
}

export async function getBookingPrice(sessionId: string): Promise<
  | {
      ok: true;
      euroTotal: number;
      lineItems: Awaited<ReturnType<typeof priceRequest>>;
      state: EngineState;
      summary: SessionSummary;
      text: string;
    }
  | {
      ok: false;
      issues: string[];
      text: string;
    }
> {
  const state = getSession(sessionId);
  const pricingPayload = buildPayloadForPricing(state);

  if (!pricingPayload.ok) {
    return {
      ok: false,
      issues: pricingPayload.issues,
      text: `The booking payload is not ready for pricing.\n\nMissing or invalid fields:\n${pricingPayload.issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    };
  }

  const lineItems = await priceRequest(pricingPayload.payload);
  const euroTotal = sumNetToEuros(lineItems);
  const updatedPayload = AppointmentRequest.parse({
    ...pricingPayload.payload,
    confirmedPrice: euroTotal,
  });

  const nextState: EngineState = {
    ...state,
    collected: updatedPayload,
    pricing: { lineItems, euroTotal },
  };
  sessions.set(sessionId, nextState);

  const summary = summarizeSession(sessionId, nextState);
  return {
    ok: true,
    euroTotal,
    lineItems,
    state: nextState,
    summary,
    text: `Notarity returned a total price of €${euroTotal}.`,
  };
}

export async function submitBooking(
  sessionId: string,
  confirm: boolean,
): Promise<{
  submitted: boolean;
  dryRun: boolean;
  euroTotal?: number;
  lineItems?: Awaited<ReturnType<typeof priceRequest>>;
  payload?: AppointmentRequestType;
  result?: unknown;
  issues?: string[];
  text: string;
}> {
  const state = getSession(sessionId);
  const pricingPayload = buildPayloadForPricing(state);

  if (!pricingPayload.ok) {
    return {
      submitted: false,
      dryRun: !confirm,
      issues: pricingPayload.issues,
      text: `The booking payload is not ready to submit.\n\nMissing or invalid fields:\n${pricingPayload.issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    };
  }

  const lineItems = await priceRequest(pricingPayload.payload);
  const euroTotal = sumNetToEuros(lineItems);
  const payload = debugPayload(pricingPayload.payload, euroTotal);

  if (!confirm) {
    return {
      submitted: false,
      dryRun: true,
      euroTotal,
      lineItems,
      payload,
      text: [
        "Dry-run preview — no booking was submitted.",
        `Mode: debug · draft: ${payload._appointmentRequestDraft}`,
        `Confirmed price: €${euroTotal}`,
        "Call submit_booking with confirm: true only after explicit user approval.",
      ].join("\n"),
    };
  }

  const files = await getUploadedFiles({ ...state, collected: payload });
  const result = await submitRequest(payload, files);

  const nextState: EngineState = {
    ...state,
    collected: payload,
    pricing: { lineItems, euroTotal },
  };
  sessions.set(sessionId, nextState);

  return {
    submitted: true,
    dryRun: false,
    euroTotal,
    lineItems,
    payload,
    result,
    text: `Booking submitted in debug mode (draft ${payload._appointmentRequestDraft}). Confirmed price: €${euroTotal}.`,
  };
}

/** Test helper — reset in-memory sessions between replay runs. */
export function resetBookingSessions(): void {
  sessions.clear();
}
