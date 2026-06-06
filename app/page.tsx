"use client";

import { useState } from "react";

import { Chat, type CompleteBooking } from "@/components/Chat";
import { Summary } from "@/components/Summary";

export default function Home() {
  const [booking, setBooking] = useState<CompleteBooking | null>(null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 text-center sm:text-left">
          <p className="text-sm font-medium uppercase tracking-widest text-slate-500">
            Notarity hackathon
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Formless
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            AI booking assistant — answer a few questions and we&apos;ll assemble
            a valid appointment request, priced server-side.
          </p>
        </header>

        <div className="grid flex-1 gap-6 lg:grid-cols-2">
          <Chat onComplete={setBooking} />
          {booking && (
            <Summary
              payload={booking.payload}
              lineItems={booking.lineItems}
              confirmedPrice={booking.confirmedPrice}
              files={booking.files}
            />
          )}
        </div>

        <footer className="mt-8 text-center text-xs text-slate-400">
          Debug mode · staging only · no production submit
        </footer>
      </div>
    </main>
  );
}
