"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { AddToCalendar } from "@/components/AddToCalendar";
import type { CalendarEventInput } from "@/components/calendar-export";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { centsToEuros } from "@/lib/price-display";
type BookingSuccessProps = {
  confirmedPrice: number;
  grossTotalCents: number;
  destinationCountry: string;
  countryLabel?: string;
  timeslotLabel: string;
  referenceId: string | null;
  calendarEventInput: CalendarEventInput;
  className?: string;
};

function extractReferenceId(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;
  for (const key of ["id", "_id", "appointmentRequestId", "requestId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

export function referenceIdFromBookResult(result: unknown): string | null {
  return extractReferenceId(result);
}

export function BookingSuccess({
  confirmedPrice,
  grossTotalCents,
  destinationCountry,
  countryLabel,
  timeslotLabel,
  referenceId,
  calendarEventInput,
  className,
}: BookingSuccessProps): React.ReactElement {
  return (
    <div
      className={cn(
        "success-enter flex flex-col items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-8 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="success-pop flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          className="size-8"
          aria-hidden
        />
      </div>

      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">
          You&apos;re booked!
        </h3>
        <p className="text-sm text-muted-foreground">
          Your appointment request was submitted in debug mode.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2 rounded-xl border border-border/60 bg-card p-4 text-left text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Total (excl. VAT)</span>
          <span className="text-lg font-bold tabular-nums text-primary">
            €{centsToEuros(grossTotalCents).toFixed(2)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Confirmed net price: €{confirmedPrice.toFixed(2)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">
            {countryLabel ?? destinationCountry}
          </Badge>
          <Badge variant="outline">{timeslotLabel}</Badge>
        </div>
        {referenceId ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Reference:{" "}
            <span className="font-mono text-foreground">{referenceId}</span>
          </p>
        ) : null}
      </div>

      <AddToCalendar
        eventInput={calendarEventInput}
        className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-4 text-center"
      />

      <div className="max-w-sm space-y-1 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">What happens next</p>
        <p>
          In live mode, notarity would email you a confirmation and appointment
          details. In debug mode, no emails are sent — you&apos;re demo-ready.
        </p>
      </div>
    </div>
  );
}
