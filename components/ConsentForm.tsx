"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EngineStep } from "@/lib/engine";

type ConsentStep = Extract<EngineStep, { type: "consent" }>;

export function ConsentForm({
  step,
  loading,
  onSubmit,
}: {
  step: ConsentStep;
  loading: boolean;
  onSubmit: (values: { newsletter?: boolean; termsAccepted?: boolean }) => void;
}): React.ReactElement {
  const [newsletter, setNewsletter] = useState(step.newsletter ?? false);
  const [termsAccepted, setTermsAccepted] = useState(step.termsAccepted ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step.termsRequired && !termsAccepted) {
      setError("Please accept the terms and conditions to continue.");
      return;
    }
    setError(null);
    const values: { newsletter?: boolean; termsAccepted?: boolean } = {};
    if (step.showNewsletter) {
      values.newsletter = newsletter;
    }
    if (step.termsRequired) {
      values.termsAccepted = termsAccepted;
    }
    onSubmit(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <p className="text-sm font-medium">{step.title}</p>
      {(step.error ?? error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {step.error ?? error}
        </p>
      )}

      {step.showNewsletter && (
        <div className="flex items-start gap-3">
          <input
            id="consent-newsletter"
            type="checkbox"
            checked={newsletter}
            onChange={(event) => setNewsletter(event.target.checked)}
            disabled={loading}
            className="mt-0.5 size-4 shrink-0 rounded border border-input accent-primary"
          />
          <Label
            htmlFor="consent-newsletter"
            className="cursor-pointer text-sm leading-relaxed text-foreground"
          >
            Subscribe to the notarity newsletter for updates and tips
          </Label>
        </div>
      )}

      {step.termsRequired && (
        <div className="flex items-start gap-3">
          <input
            id="consent-terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            disabled={loading}
            className={cn(
              "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary",
              error && !termsAccepted && "border-destructive",
            )}
          />
          <Label
            htmlFor="consent-terms"
            className="cursor-pointer text-sm leading-relaxed text-foreground"
          >
            I accept the{" "}
            <a
              href="https://notarity.com/en/terms-and-conditions"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              terms and conditions
            </a>
          </Label>
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        Continue
      </Button>
    </form>
  );
}
