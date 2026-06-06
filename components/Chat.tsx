"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AppointmentRequest } from "@/lib/booking-schema";
import type { EngineState, EngineStep } from "@/lib/engine";
import type { PriceLineItem } from "@/lib/notarity-api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CompleteBooking = {
  payload: AppointmentRequest;
  lineItems: PriceLineItem[];
  confirmedPrice: number;
  files: File[];
};

type ChatProps = {
  onComplete: (booking: CompleteBooking) => void;
};

type ChatResponse = {
  step: EngineStep;
  state: EngineState;
};

export function Chat({ onComplete }: ChatProps): React.ReactElement {
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<string[] | undefined>();
  const [currentAccessor, setCurrentAccessor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const uploadedFilesRef = useRef<File[]>([]);
  const bootstrapped = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const applyStep = useCallback(
    (response: ChatResponse) => {
      setEngineState(response.state);
      setMessages(response.state.messages);

      if (response.step.type === "complete") {
        setFinished(true);
        setOptions(undefined);
        setCurrentAccessor(undefined);
        onComplete({
          payload: response.step.payload,
          lineItems: response.state.pricing?.lineItems ?? [],
          confirmedPrice: response.step.payload.confirmedPrice,
          files: uploadedFilesRef.current,
        });
        return;
      }

      setCurrentAccessor(response.step.accessor);
      setOptions(response.step.options);
    },
    [onComplete],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: engineState,
            userMessage: text,
          }),
        });

        const data = (await response.json()) as ChatResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Chat request failed");
        }

        applyStep(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [engineState, applyStep],
  );

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    void sendMessage("");
  }, [sendMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading || finished) {
      return;
    }
    setInput("");
    void sendMessage(trimmed);
  };

  const handleQuickReply = (value: string) => {
    if (loading || finished) {
      return;
    }
    void sendMessage(value);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || loading || finished) {
      return;
    }
    uploadedFilesRef.current = [
      ...uploadedFilesRef.current.filter((f) => f.name !== file.name),
      file,
    ];
    void sendMessage(file.name);
    event.target.value = "";
  };

  const showFileInput =
    currentAccessor === "products" &&
    messages.at(-1)?.content.toLowerCase().includes("pdf");

  const formatOption = (option: string): string => {
    if (currentAccessor === "timeslots" && engineState?.availableTimeslots) {
      const slot = engineState.availableTimeslots.find((s) => s.id === option);
      if (slot) {
        return new Date(slot.startTime).toLocaleString("en-GB", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Vienna",
        });
      }
    }
    return option;
  };

  if (finished) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-sm font-medium text-emerald-800">
          Booking complete — review the summary and click Book it to submit.
        </p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-[28rem] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && loading && (
          <p className="text-sm text-slate-500">Starting assistant…</p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {loading && messages.length > 0 && (
          <p className="text-xs text-slate-400">Thinking…</p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {options && options.length > 0 && !loading && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          {options
            .filter((o) => o !== "Auto-added product")
            .slice(0, 8)
            .map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleQuickReply(option)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                {formatOption(option)}
              </button>
            ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-200 p-4"
      >
        {showFileInput && (
          <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Upload PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        )}
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type your answer…"
          disabled={loading}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none ring-slate-300 focus:ring-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
