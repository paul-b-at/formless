import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AppointmentRequest } from "../lib/booking-schema";
import { advance, type EngineState, type EngineStep } from "../lib/engine";
import { parseBookingForm } from "../lib/form-interpreter";
import {
  getBookingForm,
  priceRequest,
  submitRequest,
  sumNetToEuros,
} from "../lib/notarity-api";

const DEFAULT_SLUG = "start-vienna-hackathon";
const REFERENCE_FILES_DIR = "notarity-reference";

const sessions = new Map<string, EngineState>();

const StartBookingInput = z.object({
  slug: z.string().min(1).optional(),
});

const AnswerInput = z.object({
  sessionId: z.string().min(1),
  userMessage: z.string().min(1),
});

const SessionInput = z.object({
  sessionId: z.string().min(1),
});

const SubmitBookingInput = z.object({
  sessionId: z.string().min(1),
  confirm: z.boolean(),
});

type Summary = {
  sessionId: string;
  collectedFields: string[];
  missingFields: string[];
  complete: boolean;
  confirmedPrice?: number;
  lastAssistantMessage?: string;
};

async function loadEnvLocal(): Promise<void> {
  const envPath = join(process.cwd(), ".env.local");
  try {
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      const rawValue = match[2];
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = (rawValue ?? "").replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Bun usually loads .env.local itself; this is only a quiet fallback.
  }
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function getSession(sessionId: string): EngineState {
  const state = sessions.get(sessionId);
  if (!state) {
    throw new Error(`Unknown booking session: ${sessionId}`);
  }
  return state;
}

function summarize(
  sessionId: string,
  state: EngineState,
  step?: EngineStep,
): Summary {
  const collected = state.collected;
  const collectedFields = Object.keys(collected).sort();
  const missingFields =
    step?.type === "ask" ? [step.accessor] : [];
  const lastAssistantMessage =
    step?.type === "ask"
      ? step.question
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

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "payload";
    return `${path}: ${issue.message}`;
  });
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
  const fileNames = state.collected.products?.flatMap((product) => product.files) ?? [];
  const uniqueFileNames = [...new Set(fileNames)];

  return Promise.all(
    uniqueFileNames.map(async (name) => ({
      name,
      data: await readFile(join(process.cwd(), REFERENCE_FILES_DIR, name)),
    })),
  );
}

const server = new McpServer({
  name: "formless-notarity-booking",
  version: "0.1.0",
});

server.registerTool(
  "start_booking",
  {
    title: "Start Notarity booking",
    description:
      "Start a schema-driven Notarity booking session using the Formless engine.",
    inputSchema: StartBookingInput.shape,
  },
  async ({ slug }) => {
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

    const summary = summarize(sessionId, state, step);
    const text =
      step.type === "ask"
        ? `Started booking session ${sessionId}.\n\n${step.question}`
        : `Started booking session ${sessionId}. The booking payload is complete.`;

    return textResult(text, {
      sessionId,
      step,
      stateSummary: summary,
    });
  },
);

server.registerTool(
  "answer",
  {
    title: "Answer booking question",
    description:
      "Send the user's next answer through the existing Formless booking engine.",
    inputSchema: AnswerInput.shape,
  },
  async ({ sessionId, userMessage }) => {
    const state = getSession(sessionId);
    const result = await advance(state, userMessage);
    sessions.set(sessionId, result.state);

    const summary = summarize(sessionId, result.state, result.step);
    const text =
      result.step.type === "ask"
        ? [
            result.step.question,
            "",
            `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
            `Missing fields: ${summary.missingFields.join(", ") || "none"}`,
            `Complete: ${summary.complete ? "yes" : "no"}`,
          ].join("\n")
        : [
            "The booking payload is complete.",
            `Confirmed price: €${result.step.payload.confirmedPrice}`,
            `Collected fields: ${summary.collectedFields.join(", ") || "none"}`,
            "Use get_price before submit_booking.",
          ].join("\n");

    return textResult(text, {
      sessionId,
      step: result.step,
      collected: result.state.collected,
      stateSummary: summary,
    });
  },
);

server.registerTool(
  "get_price",
  {
    title: "Get Notarity price",
    description:
      "Price the current booking payload with the existing Notarity pricing helper.",
    inputSchema: SessionInput.shape,
  },
  async ({ sessionId }) => {
    const state = getSession(sessionId);
    const pricingPayload = buildPayloadForPricing(state);

    if (!pricingPayload.ok) {
      return textResult(
        `The booking payload is not ready for pricing.\n\nMissing or invalid fields:\n${pricingPayload.issues
          .map((issue) => `- ${issue}`)
          .join("\n")}`,
        {
          sessionId,
          ready: false,
          issues: pricingPayload.issues,
        },
      );
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

    return textResult(`Notarity returned a total price of €${euroTotal}.`, {
      sessionId,
      ready: true,
      confirmedPrice: euroTotal,
      lineItems,
      stateSummary: summarize(sessionId, nextState),
    });
  },
);

server.registerTool(
  "submit_booking",
  {
    title: "Submit Notarity booking",
    description:
      "Submit the current booking payload through the existing Notarity appointment helper.",
    inputSchema: SubmitBookingInput.shape,
  },
  async ({ sessionId, confirm }) => {
    if (!confirm) {
      return textResult(
        "Submission was not confirmed. No booking was submitted.",
        { sessionId, submitted: false },
      );
    }

    const state = getSession(sessionId);
    const pricingPayload = buildPayloadForPricing(state);
    if (!pricingPayload.ok) {
      return textResult(
        `The booking payload is not ready to submit.\n\nMissing or invalid fields:\n${pricingPayload.issues
          .map((issue) => `- ${issue}`)
          .join("\n")}`,
        {
          sessionId,
          submitted: false,
          issues: pricingPayload.issues,
        },
      );
    }

    const lineItems = await priceRequest(pricingPayload.payload);
    const euroTotal = sumNetToEuros(lineItems);
    const payload = AppointmentRequest.parse({
      ...pricingPayload.payload,
      mode: "debug",
      confirmedPrice: euroTotal,
    });
    const files = await getUploadedFiles({ ...state, collected: payload });
    const result = await submitRequest(payload, files);

    const nextState: EngineState = {
      ...state,
      collected: payload,
      pricing: { lineItems, euroTotal },
    };
    sessions.set(sessionId, nextState);

    return textResult(`Booking submitted in debug mode. Confirmed price: €${euroTotal}.`, {
      sessionId,
      submitted: true,
      confirmedPrice: euroTotal,
      lineItems,
      result,
    });
  },
);

async function main(): Promise<void> {
  await loadEnvLocal();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Formless Notarity MCP server running on stdio.");
}

main().catch((error: unknown) => {
  console.error("Formless Notarity MCP server failed:", error);
  process.exit(1);
});
