import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppointmentRequest } from "@/lib/booking-schema";
import {
  priceRequest,
  submitRequest,
  sumNetToEuros,
} from "@/lib/notarity";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();

    const payloadRaw = formData.get("payload");
    if (typeof payloadRaw !== "string") {
      return NextResponse.json(
        { error: "Missing payload field" },
        { status: 400 },
      );
    }

    const parsed = AppointmentRequest.parse(JSON.parse(payloadRaw));

    const files: { name: string; data: Blob }[] = [];
    for (const entry of formData.getAll("files")) {
      if (entry instanceof File) {
        files.push({ name: entry.name, data: entry });
      }
    }

    const lineItems = await priceRequest(parsed);
    const confirmedPrice = sumNetToEuros(lineItems);

    const payloadWithPrice = AppointmentRequest.parse({
      ...parsed,
      confirmedPrice,
    });

    const result = await submitRequest(payloadWithPrice, files);

    return NextResponse.json({
      confirmedPrice,
      lineItems,
      result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid payload", details: error.flatten() },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
