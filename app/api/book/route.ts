import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  bookingErrorDetailsToText,
  formatZodIssues,
  parseNotaritySubmitError,
} from "@/lib/booking-errors";
import { AppointmentRequest } from "@/lib/booking-schema";
import { sanitizeAppointmentPayload } from "@/lib/party-sanitize";
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

    const parsed = AppointmentRequest.parse(
      sanitizeAppointmentPayload(JSON.parse(payloadRaw)),
    );

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
      const details = { kind: "zod" as const, issues: formatZodIssues(error) };
      console.error(
        "[book] Zod validation failed:",
        bookingErrorDetailsToText(details),
      );
      return NextResponse.json(
        { error: "Invalid payload", details },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    const notarity = parseNotaritySubmitError(message);

    if (notarity) {
      const details = {
        kind: "notarity" as const,
        status: notarity.status,
        statusText: notarity.statusText,
        body: notarity.body,
      };
      console.error(
        "[book] Notarity submit failed:",
        bookingErrorDetailsToText(details),
      );
      return NextResponse.json(
        {
          error: `Notarity rejected the booking (${notarity.status})`,
          details,
        },
        { status: 502 },
      );
    }

    console.error("[book] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
