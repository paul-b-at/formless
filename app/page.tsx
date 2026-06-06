"use client";

import { useState } from "react";

import { Chat, type CompleteBooking } from "@/components/Chat";
import { Summary } from "@/components/Summary";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EngineState, EngineStep } from "@/lib/engine";

export default function Home() {
  const [booking, setBooking] = useState<CompleteBooking | null>(null);
  const [chatResume, setChatResume] = useState<{
    state: EngineState;
    step: EngineStep;
  } | null>(null);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card/50 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-lg text-primary-foreground"
          >
            ✦
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Formless
              </h1>
              <Badge variant="secondary" className="hidden sm:inline-flex">
                Notarity · START Vienna &apos;26
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              Book a notarisation in minutes — just answer a few questions.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:gap-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-full lg:flex-[1.1]">
          <Chat
            onComplete={setBooking}
            resumeFrom={chatResume}
            onResumeHandled={() => setChatResume(null)}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-full">
          {booking ? (
            <Summary
              booking={booking}
              onBookingUpdate={setBooking}
              onReask={(resume) => {
                setBooking(null);
                setChatResume(resume);
              }}
            />
          ) : (
            <Card className="flex h-full min-h-[12rem] flex-col border-dashed lg:min-h-0">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>
                  Your price breakdown and booking review will appear here once
                  the conversation is complete.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <span className="text-3xl opacity-40" aria-hidden>
                  📋
                </span>
                <p className="max-w-xs text-sm">
                  Complete the chat on the left to see line items and submit in
                  debug mode.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
        Debug mode · staging only · draft id reused for safe testing
      </footer>
    </div>
  );
}
