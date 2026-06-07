"use client";

import { useCallback, useState } from "react";

import {
  BookingProgress,
  bookingProgressPercent,
  type BookingProgressState,
} from "@/components/BookingProgress";
import { Chat, type CompleteBooking } from "@/components/Chat";
import { FormlessLogo } from "@/components/FormlessLogo";
import { Summary } from "@/components/Summary";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { EngineState, EngineStep } from "@/lib/engine";
import type { AppointmentRequest } from "@/lib/booking-schema";

const INITIAL_PROGRESS: BookingProgressState = {
  collected: {},
  finished: false,
  booked: false,
};

export default function Home() {
  const [booking, setBooking] = useState<CompleteBooking | null>(null);
  const [chatResume, setChatResume] = useState<{
    state: EngineState;
    step: EngineStep;
  } | null>(null);
  const [progress, setProgress] = useState<BookingProgressState>(INITIAL_PROGRESS);

  const showSummary = booking !== null;

  const handleSessionProgress = useCallback(
    (update: {
      collected: Partial<AppointmentRequest>;
      finished: boolean;
    }) => {
      setProgress((prev) => ({
        ...prev,
        collected: update.collected,
        finished: update.finished,
      }));
    },
    [],
  );

  const handleBooked = useCallback(() => {
    setProgress((prev) => ({ ...prev, booked: true }));
  }, []);

  const handleBookingUpdate = useCallback((next: CompleteBooking | null) => {
    setBooking(next);
    if (!next) {
      setProgress((prev) => ({ ...prev, booked: false, finished: false }));
    }
  }, []);

  const progressValue = bookingProgressPercent(progress);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="shrink-0 bg-card">
        <div
          className={cn(
            "mx-auto flex w-full flex-col motion-reduce:transition-none transition-[max-width] duration-300 ease-out",
            showSummary ? "max-w-6xl" : "max-w-2xl",
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <FormlessLogo />
            <Badge
              variant="secondary"
              className="hidden shrink-0 sm:inline-flex"
            >
              Notarity · START Vienna &apos;26
            </Badge>
          </div>
          <div className="px-4 sm:px-6">
            <div className="flex min-h-14 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <BookingProgress state={progress} className="min-w-0 flex-1" compact />
              <Progress
                value={progressValue}
                className="h-1.5 w-full shrink-0 sm:max-w-[8rem] motion-reduce:transition-none"
                aria-label={`${progressValue}% complete`}
              />
            </div>
            <div
              role="presentation"
              className="border-b border-border"
              aria-hidden
            />
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto grid min-h-0 w-full flex-1 grid-cols-1 gap-4 overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 motion-reduce:transition-none transition-[max-width,gap] duration-300 ease-out",
          showSummary
            ? "max-w-6xl lg:grid-cols-2 lg:items-stretch lg:gap-6 lg:overflow-hidden"
            : "max-w-2xl",
        )}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <Chat
            onComplete={handleBookingUpdate}
            resumeFrom={chatResume}
            onResumeHandled={() => setChatResume(null)}
            onSessionProgress={handleSessionProgress}
          />
        </div>

        {showSummary && booking ? (
          <div className="summary-enter flex h-full min-h-0 min-w-0 flex-col">
            <Summary
              booking={booking}
              onBookingUpdate={handleBookingUpdate}
              onReask={(resume) => {
                handleBookingUpdate(null);
                setChatResume(resume);
              }}
              onBooked={handleBooked}
            />
          </div>
        ) : null}
      </main>

      <footer className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
        Debug mode · staging only · draft id reused for safe testing
      </footer>
    </div>
  );
}
