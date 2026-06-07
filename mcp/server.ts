import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  answerBooking,
  getBookingPrice,
  startBooking,
  submitBooking,
} from "./booking-session";

const StartBookingInput = z.object({
  slug: z.string().min(1).optional(),
});

const AnswerInputSchema = z.object({
  sessionId: z.string().min(1),
  userMessage: z.string().optional(),
  structuredAnswer: z.record(z.unknown()).optional(),
  uploadProductId: z.string().optional(),
  uploadKind: z.enum(["file"]).optional(),
});

const AnswerInput = AnswerInputSchema.refine(
  (input) =>
    Boolean(input.structuredAnswer) ||
    Boolean(input.userMessage?.trim()),
  { message: "Provide userMessage or structuredAnswer" },
);

const SessionInput = z.object({
  sessionId: z.string().min(1),
});

const SubmitBookingInput = z.object({
  sessionId: z.string().min(1),
  confirm: z.boolean(),
});

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

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

const server = new McpServer({
  name: "formless-notarity-booking",
  version: "0.1.0",
});

server.registerTool(
  "start_booking",
  {
    title: "Start Notarity booking",
    description:
      "Start a schema-driven Notarity booking session using the Formless engine (advance + live form schema).",
    inputSchema: StartBookingInput.shape,
  },
  async ({ slug }) => {
    const result = await startBooking(slug);
    return textResult(result.text, {
      sessionId: result.sessionId,
      step: result.step,
      stateSummary: result.summary,
    });
  },
);

server.registerTool(
  "answer",
  {
    title: "Answer booking question",
    description:
      "Send the user's next answer through advance() in lib/engine.ts. For per-product file uploads, pass uploadKind: \"file\" and uploadProductId from the fileUpload step.",
    inputSchema: AnswerInputSchema.shape,
  },
  async ({
    sessionId,
    userMessage,
    structuredAnswer,
    uploadProductId,
    uploadKind,
  }) => {
    const result = await answerBooking({
      sessionId,
      userMessage: userMessage?.trim() ?? "",
      structuredAnswer,
      uploadProductId,
      uploadKind,
    });

    return textResult(result.text, {
      sessionId,
      step: result.step,
      collected: result.state.collected,
      sessionFileOwners: result.state.sessionFileOwners,
      stateSummary: result.summary,
    });
  },
);

server.registerTool(
  "get_price",
  {
    title: "Get Notarity price",
    description:
      "Price the current booking payload via priceRequest() — never computed locally.",
    inputSchema: SessionInput.shape,
  },
  async ({ sessionId }) => {
    const result = await getBookingPrice(sessionId);
    if (!result.ok) {
      return textResult(result.text, {
        sessionId,
        ready: false,
        issues: result.issues,
      });
    }

    return textResult(result.text, {
      sessionId,
      ready: true,
      confirmedPrice: result.euroTotal,
      lineItems: result.lineItems,
      stateSummary: result.summary,
    });
  },
);

server.registerTool(
  "submit_booking",
  {
    title: "Submit Notarity booking",
    description:
      "confirm: false returns a dry-run preview (payload + price). confirm: true submits in debug mode with the test draft id.",
    inputSchema: SubmitBookingInput.shape,
  },
  async ({ sessionId, confirm }) => {
    const result = await submitBooking(sessionId, confirm);
    return textResult(result.text, {
      sessionId,
      submitted: result.submitted,
      dryRun: result.dryRun,
      confirmedPrice: result.euroTotal,
      lineItems: result.lineItems,
      payload: result.payload,
      issues: result.issues,
      result: result.result,
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
