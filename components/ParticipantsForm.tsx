"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EngineStep } from "@/lib/engine";
import {
  defaultParticipantRow,
  type ParticipantRow,
} from "@/lib/participant-config";
import { isValidEmail } from "@/lib/field-validation";

type ParticipantsStep = Extract<EngineStep, { type: "participants" }>;

function emptyRow(): ParticipantRow {
  return defaultParticipantRow("");
}

export function ParticipantsForm({
  step,
  loading,
  primaryEmailSuggestion,
  onSubmit,
}: {
  step: ParticipantsStep;
  loading: boolean;
  /** Prefill suggestion for the first participant only — OCR or remembered email. */
  primaryEmailSuggestion?: { value: string; label: string };
  onSubmit: (answer: Record<string, unknown>) => void;
}): React.ReactElement {
  const [rows, setRows] = useState<ParticipantRow[]>(() => {
    if (step.participants.length > 0) {
      return step.participants.map((row) => ({ ...row }));
    }
    const first = emptyRow();
    if (primaryEmailSuggestion?.value) {
      first.email = primaryEmailSuggestion.value;
    }
    return [first];
  });
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | undefined>();

  const canAddAnother = rows.length < step.maxParticipants;
  const canRemove = rows.length > 1;

  const validRows = useMemo(
    () =>
      rows
        .map((row) => ({ ...row, email: row.email.trim() }))
        .filter((row) => row.email.length > 0),
    [rows],
  );

  const validateRows = (finalize: boolean): boolean => {
    const errors: Record<number, string> = {};
    const emails = new Set<string>();

    rows.forEach((row, index) => {
      const email = row.email.trim();
      if (!email) {
        if (finalize || rows.length === 1) {
          errors[index] = "Email is required";
        }
        return;
      }
      if (!isValidEmail(email)) {
        errors[index] = "Enter a valid email address";
        return;
      }
      const key = email.toLowerCase();
      if (emails.has(key)) {
        errors[index] = "Each participant needs a unique email";
        return;
      }
      emails.add(key);
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      return false;
    }

    if (finalize && validRows.length < step.minParticipants) {
      setFormError(
        `Please add at least ${step.minParticipants} participant email${step.minParticipants === 1 ? "" : "s"}.`,
      );
      return false;
    }

    setFormError(undefined);
    return true;
  };

  const handleEmailChange = (index: number, email: string) => {
    setRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, email } : row,
      ),
    );
    setFieldErrors((prev) => {
      if (!prev[index]) {
        return prev;
      }
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setFormError(undefined);
  };

  const handleRemove = (index: number) => {
    if (!canRemove) {
      return;
    }
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    setFieldErrors({});
    setFormError(undefined);
  };

  const handleAddAnother = () => {
    if (!canAddAnother) {
      return;
    }
    setRows((prev) => [...prev, emptyRow()]);
    setFormError(undefined);
  };

  const handleContinue = () => {
    if (!validateRows(true)) {
      return;
    }
    onSubmit({
      participants: validRows,
      finalize: true,
    });
  };

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-medium">{step.title}</p>
      {step.error ? (
        <p className="text-sm text-destructive">{step.error}</p>
      ) : null}
      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={`participant-${index}`} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Label htmlFor={`participant-email-${index}`}>
                    Participant {index + 1} email
                  </Label>
                  {index === 0 && primaryEmailSuggestion?.value ? (
                    <span className="text-[10px] font-medium text-primary">
                      {primaryEmailSuggestion.label}
                    </span>
                  ) : null}
                </div>
                <Input
                  id={`participant-email-${index}`}
                  type="email"
                  value={row.email}
                  disabled={loading}
                  placeholder="signer@example.com"
                  className={cn(
                    index === 0 &&
                      primaryEmailSuggestion?.value &&
                      "border-primary/30 bg-primary/5",
                  )}
                  onChange={(event) =>
                    handleEmailChange(index, event.target.value)
                  }
                />
              </div>
              {canRemove ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => handleRemove(index)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {fieldErrors[index] ? (
              <p className="text-sm text-destructive">{fieldErrors[index]}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {canAddAnother ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={handleAddAnother}
          >
            Add another signer
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={loading}
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
