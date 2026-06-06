"use client";

import { useState } from "react";

import type { AppointmentRequest } from "@/lib/booking-schema";
import type { PriceLineItem } from "@/lib/notarity-api";

type SummaryProps = {
  payload: AppointmentRequest;
  lineItems: PriceLineItem[];
  confirmedPrice: number;
  files: File[];
};

type BookResult = {
  confirmedPrice: number;
  lineItems: PriceLineItem[];
  result: unknown;
};

export function Summary({
  payload,
  lineItems,
  confirmedPrice,
  files,
}: SummaryProps): React.ReactElement {
  const [booking, setBooking] = useState(false);
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);

  const handleBook = async () => {
    setBooking(true);
    setBookError(null);

    try {
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));

      for (const file of files) {
        formData.append("files", file, file.name);
      }

      for (const product of payload.products) {
        for (const fileName of product.files) {
          if (!files.some((f) => f.name === fileName)) {
            throw new Error(
              `Missing upload for required file: ${fileName}. Please upload both PDFs during the chat.`,
            );
          }
        }
      }

      const response = await fetch("/api/book", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as BookResult & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Booking failed");
      }

      setBookResult(data);
    } catch (error) {
      setBookError(
        error instanceof Error ? error.message : "Booking failed",
      );
    } finally {
      setBooking(false);
    }
  };

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; book</h2>
        <p className="mt-1 text-sm text-slate-600">
          Confirm your appointment request before submitting.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Destination
          </h3>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {payload.destinationCountry}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Timeslot
          </h3>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {payload.timeslots.join(", ")}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Products
        </h3>
        <ul className="mt-2 space-y-2">
          {payload.products.map((product) => (
            <li key={product.id} className="text-sm text-slate-800">
              <span className="font-medium">{product.id}</span>
              {product.files.length > 0 && (
                <span className="text-slate-500">
                  {" "}
                  — {product.files.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-slate-50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Billing contact
        </h3>
        <p className="mt-1 text-sm text-slate-800">
          {payload.billingDetails.firstName} {payload.billingDetails.lastName}
          <br />
          {payload.billingDetails.email}
          <br />
          {payload.billingDetails.address}, {payload.billingDetails.city}{" "}
          {payload.billingDetails.zipCode}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Price breakdown
        </h3>
        {lineItems.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {lineItems.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-slate-700">{item.name}</span>
                <span className="font-medium text-slate-900">
                  €{(item.net / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Total confirmed from server pricing.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-sm font-semibold text-slate-900">Total</span>
          <span className="text-lg font-bold text-slate-900">
            €{confirmedPrice.toFixed(2)}
          </span>
        </div>
      </div>

      {files.length > 0 && (
        <p className="text-xs text-slate-500">
          {files.length} file(s) ready to upload:{" "}
          {files.map((f) => f.name).join(", ")}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleBook()}
        disabled={booking || bookResult !== null}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {booking ? "Submitting…" : "Book it"}
      </button>

      {bookError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {bookError}
        </p>
      )}

      {bookResult && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Appointment request submitted (debug mode)</p>
          <p className="mt-1">
            Confirmed price: €{bookResult.confirmedPrice.toFixed(2)}
          </p>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-white/60 p-2 text-xs text-emerald-900">
            {JSON.stringify(bookResult.result, null, 2)}
          </pre>
        </div>
      )}

      <p className="text-xs text-slate-400">
        mode: {payload.mode} · draft: {payload._appointmentRequestDraft}
      </p>
    </section>
  );
}
