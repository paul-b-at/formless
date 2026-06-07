"use client";

import { cn } from "@/lib/utils";
import type { AppointmentRequest } from "@/lib/booking-schema";

const STEPS = [
  { id: "document", label: "Document" },
  { id: "details", label: "Details" },
  { id: "timeslot", label: "Timeslot" },
  { id: "review", label: "Review" },
  { id: "booked", label: "Booked" },
] as const;

export type BookingProgressState = {
  collected: Partial<AppointmentRequest>;
  finished: boolean;
  booked: boolean;
};

function stepCompleted(
  stepId: (typeof STEPS)[number]["id"],
  state: BookingProgressState,
): boolean {
  const { collected, finished, booked } = state;

  switch (stepId) {
    case "document":
      return Boolean(collected.destinationCountry && collected.products?.length);
    case "details":
      return Boolean(
        collected.billingDetails?.email && collected.participants?.length,
      );
    case "timeslot":
      return Boolean(collected.timeslots?.length);
    case "review":
      return finished;
    case "booked":
      return booked;
    default:
      return false;
  }
}

function activeStepIndex(state: BookingProgressState): number {
  const index = STEPS.findIndex((step) => !stepCompleted(step.id, state));
  return index === -1 ? STEPS.length - 1 : index;
}

export function bookingProgressPercent(state: BookingProgressState): number {
  const completedCount = STEPS.filter((step) =>
    stepCompleted(step.id, state),
  ).length;
  return Math.round((completedCount / STEPS.length) * 100);
}

export function BookingProgress({
  state,
  className,
  compact = false,
}: {
  state: BookingProgressState;
  className?: string;
  compact?: boolean;
}): React.ReactElement {
  const activeIndex = activeStepIndex(state);

  return (
    <nav
      aria-label="Booking progress"
      className={cn("w-full", className)}
    >
      <ol
        className={cn(
          "flex min-h-8 items-center gap-1 px-4 py-4 sm:gap-2",
          compact
            ? "justify-start overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "justify-between",
        )}
      >
        {STEPS.map((step, index) => {
          const done = stepCompleted(step.id, state);
          const active = index === activeIndex && !done;
          const upcoming = index > activeIndex && !done;

          return (
            <li
              key={step.id}
              className={cn(
                "flex min-w-0 items-center gap-1 sm:gap-2",
                index < STEPS.length - 1 && "flex-1",
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-full",
                    active ? "size-8 ring-2 ring-primary" : "size-6",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors motion-reduce:transition-none",
                      done && "bg-primary text-primary-foreground",
                      active && "bg-primary text-primary-foreground",
                      upcoming && "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                </span>
                <span
                  className={cn(
                    "truncate text-xs font-medium",
                    done || active
                      ? "text-foreground"
                      : "text-muted-foreground",
                    compact && "hidden sm:inline",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "hidden h-px min-w-3 flex-1 sm:block",
                    done ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
