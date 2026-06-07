import { NextResponse } from "next/server";
import { z } from "zod";

import { advance, type EngineState } from "@/lib/engine";
import { parseBookingForm } from "@/lib/form-interpreter";
import { getBookingForm } from "@/lib/notarity";

export const runtime = "nodejs";

const ChatRequestSchema = z.object({
  state: z
    .object({
      form: z.unknown(),
      collected: z.record(z.unknown()).optional(),
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        )
        .optional(),
      pricing: z
        .object({
          lineItems: z.array(z.record(z.unknown())),
          euroTotal: z.number(),
        })
        .optional(),
      productCatalog: z.array(z.record(z.unknown())).optional(),
      availableTimeslots: z
        .array(
          z.object({
            id: z.string(),
            startTime: z.string(),
          }),
        )
        .optional(),
      timeslotFallback: z.boolean().optional(),
      sessionFiles: z.array(z.string()).optional(),
      sessionFileOwners: z.record(z.string()).optional(),
    })
    .nullable()
    .optional(),
  userMessage: z.string().default(""),
  structuredAnswer: z.record(z.unknown()).optional(),
  sessionFiles: z.array(z.string()).optional(),
  sessionFileOwners: z.record(z.string()).optional(),
  uploadProductId: z.string().optional(),
  uploadKind: z.enum(["file"]).optional(),
});

async function bootstrapState(): Promise<EngineState> {
  const rawForm = await getBookingForm("start-vienna-hackathon");
  const form = parseBookingForm(rawForm);
  return {
    form,
    collected: {},
    messages: [],
  };
}

function restoreState(
  input: z.infer<typeof ChatRequestSchema>["state"],
): EngineState | null {
  if (!input?.form) {
    return null;
  }
  return {
    form: parseBookingForm(input.form),
    collected: (input.collected ?? {}) as EngineState["collected"],
    messages: (input.messages ?? []) as EngineState["messages"],
    pricing: input.pricing as EngineState["pricing"],
    productCatalog: input.productCatalog as EngineState["productCatalog"],
    availableTimeslots:
      input.availableTimeslots as EngineState["availableTimeslots"],
    timeslotFallback: input.timeslotFallback as EngineState["timeslotFallback"],
    sessionFiles: input.sessionFiles as EngineState["sessionFiles"],
    sessionFileOwners: input.sessionFileOwners as EngineState["sessionFileOwners"],
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = ChatRequestSchema.parse(await request.json());
    const engineState =
      restoreState(body.state) ?? (await bootstrapState());

    const sessionFiles =
      body.sessionFiles ?? engineState.sessionFiles ?? [];
    const sessionFileOwners =
      body.sessionFileOwners ?? engineState.sessionFileOwners ?? {};

    const { state, step } = await advance(
      { ...engineState, sessionFiles, sessionFileOwners },
      body.userMessage,
      body.structuredAnswer,
      body.uploadProductId,
      body.uploadKind,
    );

    return NextResponse.json({ step, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
