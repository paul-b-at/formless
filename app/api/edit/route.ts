import { NextResponse } from "next/server";
import { z } from "zod";

import { applySurgicalEdit, type EngineState } from "@/lib/engine";
import { parseBookingForm } from "@/lib/form-interpreter";

export const runtime = "nodejs";

const EditRequestSchema = z.object({
  state: z.object({
    form: z.unknown(),
    collected: z.record(z.unknown()),
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
    sessionFiles: z.array(z.string()).optional(),
    sessionFileOwners: z.record(z.string()).optional(),
  }),
  accessor: z.string(),
  value: z.unknown(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = EditRequestSchema.parse(await request.json());
    const engineState: EngineState = {
      form: parseBookingForm(body.state.form),
      collected: body.state.collected as EngineState["collected"],
      messages: (body.state.messages ?? []) as EngineState["messages"],
      pricing: body.state.pricing as EngineState["pricing"],
      productCatalog: body.state.productCatalog as EngineState["productCatalog"],
      availableTimeslots:
        body.state.availableTimeslots as EngineState["availableTimeslots"],
      sessionFiles: body.state.sessionFiles as EngineState["sessionFiles"],
      sessionFileOwners:
        body.state.sessionFileOwners as EngineState["sessionFileOwners"],
    };

    const { state, step } = await applySurgicalEdit(
      engineState,
      body.accessor,
      body.value,
    );

    return NextResponse.json({ step, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
