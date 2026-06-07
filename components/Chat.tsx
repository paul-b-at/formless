"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { toast } from "sonner";

import { ChatMessageBubble } from "@/components/ChatMessageBubble";
import { CountrySearchSelect } from "@/components/CountrySearchSelect";
import { rankOcrCountrySuggestions } from "@/components/ocr-country-suggestions";
import {
  InlineFileUploadCard,
  type UploadContentWarning,
} from "@/components/InlineFileUploadCard";
import {
  countryFlag,
  extractCountryCodeFromOption,
} from "@/components/country-display";
import { getSupportedDestinationCountries } from "@/components/supported-countries";
import { phoneFlagOrPlaceholder } from "@/components/phone-flag";
import { friendlyErrorMessage } from "@/components/friendly-errors";
import { HeroLanding } from "@/components/HeroLanding";
import { ParticipantsForm } from "@/components/ParticipantsForm";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AppointmentRequest } from "@/lib/booking-schema";
import type {
  EngineState,
  EngineStep,
  FormField,
  StepOption,
} from "@/lib/engine";
import type { PriceLineItem } from "@/lib/notarity";
import {
  isBusinessBillingSelected,
  isPartyFormValid,
  validatePartyFormFields,
} from "@/components/party-form-validation";
import { detectOcrContentMismatch } from "@/lib/ocr-content-mismatch";
import { formatOcrSummary } from "@/lib/ocr-summary";
import {
  hasOcrProductSuggestion,
  sortProductOptionsWithSuggestion,
} from "@/lib/ocr-product-map";
import {
  buildPartyFormPrefill,
  primaryParticipantEmailSuggestion,
} from "@/lib/ocr-party-prefill";
import { captureRememberedEmail } from "@/lib/remembered-email";
import { normalizeOcrParty, type OcrParty, type OcrResponse } from "@/lib/ocr-types";
import {
  formatTimeslotTimeOnly,
  groupTimeslotOptionsByDay,
} from "@/lib/timeslot-format";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CompleteBooking = {
  payload: AppointmentRequest;
  lineItems: PriceLineItem[];
  confirmedPrice: number;
  files: File[];
  availableTimeslots?: { id: string; startTime: string }[];
  engineState: EngineState;
};

type DatePickerStep = Extract<EngineStep, { type: "datePicker" }>;

type ChatSnapshot = {
  engineState: EngineState | null;
  messages: ChatMessage[];
  options: StepOption[] | undefined;
  formStep: FormStep | null;
  participantsStep: ParticipantsStep | null;
  datePickerStep: DatePickerStep | null;
  fileUploadStep: FileUploadStep | null;
  currentAccessor: string | undefined;
  runningPrice: number | undefined;
  finished: boolean;
  fileNames: string[];
};

type ChatProps = {
  onComplete: (booking: CompleteBooking | null) => void;
  resumeFrom?: { state: EngineState; step: EngineStep } | null;
  onResumeHandled?: () => void;
  onSessionProgress?: (update: {
    collected: Partial<AppointmentRequest>;
    finished: boolean;
  }) => void;
};

type ChatResponse = {
  step: EngineStep;
  state: EngineState;
};

type FormStep = Extract<EngineStep, { type: "form" }>;
type ParticipantsStep = Extract<EngineStep, { type: "participants" }>;
type FileUploadStep = Extract<EngineStep, { type: "fileUpload" }>;

function AppointmentDatePicker({
  step,
  loading,
  onSubmit,
}: {
  step: DatePickerStep;
  loading: boolean;
  onSubmit: (date: string) => void;
}): React.ReactElement {
  const [date, setDate] = useState(step.minDate);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (date) {
          onSubmit(date);
        }
      }}
      className="flex w-full min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <p className="text-sm font-medium">{step.title}</p>
      {step.error ? (
        <p className="text-sm text-destructive">{step.error}</p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="appointment-date" className="text-xs">
          Preferred date
        </Label>
        <Input
          id="appointment-date"
          type="date"
          value={date}
          min={step.minDate}
          max={step.maxDate}
          disabled={loading}
          required
          className="min-w-0 max-w-xs"
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="w-full sm:w-auto"
        disabled={loading || !date}
      >
        Use this date
      </Button>
    </form>
  );
}

type AddressSuggestion = {
  label: string;
  address: string;
  zipCode: string;
  city: string;
  stateProvince: string;
  countryCode: string;
};

function AddressAutocompleteInput({
  id,
  value,
  disabled,
  required,
  inputClassName,
  onChange,
  onSelect,
}: {
  id: string;
  value: string;
  disabled: boolean;
  required?: boolean;
  inputClassName?: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
}): React.ReactElement {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/address?text=${encodeURIComponent(trimmed)}`,
          );
          if (!response.ok) {
            return;
          }
          const data = (await response.json()) as {
            suggestions?: AddressSuggestion[];
          };
          const next = data.suggestions ?? [];
          setSuggestions(next);
          setOpen(next.length > 0);
        } catch {
          // Autocomplete is best-effort; manual entry still works.
        }
      })();
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value]);

  return (
    <div className="relative min-w-0">
      <Input
        id={id}
        type="text"
        required={required}
        value={value}
        disabled={disabled}
        autoComplete="street-address"
        className={cn("min-w-0", inputClassName)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.label} role="option">
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(suggestion);
                  setOpen(false);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollIntoStep(
  element: HTMLElement | null,
  block: ScrollLogicalPosition = "start",
): void {
  if (!element) {
    return;
  }
  element.scrollIntoView({
    block,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

function contentOverflows(container: HTMLElement | null): boolean {
  if (!container) {
    return false;
  }
  return container.scrollHeight > container.clientHeight + 1;
}

function hasConfirmableOcr(ocr: OcrResponse): boolean {
  return Boolean(
    ocr.countryOptions?.length ||
      ocr.productOptions?.length ||
      ocr.destinationCountry,
  );
}

function OcrConfirmPanel({
  ocr,
  loading,
  countryConfirmed,
  supportedCountries,
  onCountry,
  onProduct,
  onSkip,
}: {
  ocr: OcrResponse;
  loading: boolean;
  countryConfirmed: boolean;
  supportedCountries: { code: string; label: string }[];
  onCountry: (country: { code: string; label: string }) => void;
  onProduct: (product: { id: string; title: string }) => void;
  onSkip: () => void;
}): React.ReactElement {
  const [showFullCountrySearch, setShowFullCountrySearch] = useState(false);

  const showCountryStep =
    !countryConfirmed &&
    Boolean(ocr.destinationCountry || supportedCountries.length > 0);

  const topCountrySuggestions = useMemo(
    () =>
      rankOcrCountrySuggestions(
        supportedCountries,
        ocr.destinationCountry,
        ocr.destinationCountryLabel,
      ),
    [
      supportedCountries,
      ocr.destinationCountry,
      ocr.destinationCountryLabel,
    ],
  );

  const showProducts =
    Boolean(ocr.productOptions?.length) &&
    (countryConfirmed || !showCountryStep);

  const suggestedProductId = hasOcrProductSuggestion(ocr)
    ? (ocr.suggestedProductId ?? undefined)
    : undefined;

  const sortedProductOptions = useMemo(
    () =>
      sortProductOptionsWithSuggestion(
        ocr.productOptions ?? [],
        suggestedProductId,
      ),
    [ocr.productOptions, suggestedProductId],
  );

  return (
    <div className="step-enter flex min-w-0 flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
      {showCountryStep && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Destination country</p>
          {showFullCountrySearch ? (
            <CountrySearchSelect
              countries={supportedCountries}
              loading={loading}
              onSelect={(country) => {
                setShowFullCountrySearch(false);
                onCountry(country);
              }}
            />
          ) : (
            <>
              <ul className="flex min-w-0 flex-col gap-1">
                {topCountrySuggestions.map((country) => {
                  const suggested = country.code === ocr.destinationCountry;
                  const flag = countryFlag(country.code);
                  return (
                    <li key={country.code} role="presentation">
                      <button
                        type="button"
                        disabled={loading}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                          suggested
                            ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15"
                            : "border-border/80 bg-card text-foreground hover:bg-primary/8",
                        )}
                        onClick={() => onCountry(country)}
                      >
                        {flag ? (
                          <span className="text-base leading-none" aria-hidden>
                            {flag}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {country.label}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {country.code}
                        </span>
                        {suggested ? (
                          <span className="shrink-0 text-xs font-medium text-primary">
                            Suggested
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {supportedCountries.length > topCountrySuggestions.length && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={loading}
                  className="h-auto self-start px-0 text-primary"
                  onClick={() => setShowFullCountrySearch(true)}
                >
                  Search all countries
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {showProducts && sortedProductOptions.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Booking product</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {sortedProductOptions.map((product) => {
              const isSuggested = product.id === suggestedProductId;
              return (
                <li key={product.id} role="presentation">
                  <button
                    type="button"
                    disabled={loading}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                      isSuggested
                        ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15"
                        : "border-border/80 bg-card text-foreground hover:bg-primary/8",
                    )}
                    onClick={() => onProduct(product)}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal">
                      {product.title}
                    </span>
                    {isSuggested ? (
                      <span className="shrink-0 text-xs font-medium text-primary">
                        Suggested
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={loading}
        className="self-start"
        onClick={onSkip}
      >
        I&apos;ll answer manually
      </Button>
    </div>
  );
}

function countryQuickReplyValue(
  code: string,
  label: string | null | undefined,
  stepOptions?: StepOption[],
): string {
  const fromOptions = stepOptions?.find((option) => option.value === code);
  if (fromOptions) {
    return fromOptions.value;
  }
  if (label?.trim()) {
    return `${label.trim()} (${code})`;
  }
  return code;
}

function DocumentUploadZone({
  disabled,
  busy,
  hardError,
  onFile,
}: {
  disabled: boolean;
  busy: boolean;
  hardError?: string | null;
  onFile: (file: File) => void;
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || disabled || busy) {
      return;
    }
    onFile(file);
  };

  return (
    <div
      className={cn(
        "step-enter flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors motion-reduce:transition-none",
        dragOver
          ? "border-primary bg-primary/8 shadow-sm"
          : "border-border bg-card",
        (disabled || busy) && "pointer-events-none opacity-60",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <span className="text-2xl" aria-hidden>
        📄
      </span>
      {hardError ? (
        <div
          role="alert"
          className="w-full max-w-sm rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          {hardError}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {busy ? "Reading your document…" : "Start with your document"}
        </p>
        <p className="max-w-[18rem] text-xs text-muted-foreground">
          Drop a PDF here and we&apos;ll infer the country and document type to
          speed up booking (max 10 MB).
        </p>
      </div>
      {busy ? (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          <Skeleton className="h-9 w-2/3 motion-reduce:animate-none" />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={disabled || busy}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/** Aligns inline step cards with assistant message bubbles (avatar gutter + max-w-[85%]). */
function AssistantStepRow({
  children,
  className,
  innerRef,
}: {
  children: React.ReactNode;
  className?: string;
  innerRef?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
  return (
    <div
      ref={innerRef}
      className={cn("flex min-w-0 gap-2 justify-start", className)}
    >
      <Avatar size="sm" className="mt-0.5 shrink-0 bg-primary/10">
        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
          AI
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 w-full max-w-[85%]">{children}</div>
    </div>
  );
}

function TypingIndicator(): React.ReactElement {
  return (
    <div
      className="flex min-w-0 items-center gap-2 px-1"
      role="status"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      <Avatar size="sm" className="bg-primary/10">
        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
          AI
        </AvatarFallback>
      </Avatar>
      <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2">
        <div className="flex gap-1 motion-reduce:hidden">
          <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
        </div>
        <span className="text-xs text-muted-foreground motion-reduce:font-medium">
          Typing…
        </span>
      </div>
    </div>
  );
}

export function TimeslotPicker({
  options,
  availableTimeslots,
  loading,
  onConfirm,
  initialSlotId,
}: {
  options: StepOption[];
  availableTimeslots: { id: string; startTime: string }[];
  loading: boolean;
  onConfirm: (slotId: string) => void;
  initialSlotId?: string;
}): React.ReactElement {
  const dayGroups = useMemo(
    () => groupTimeslotOptionsByDay(options, availableTimeslots),
    [options, availableTimeslots],
  );

  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");

  useEffect(() => {
    if (initialSlotId) {
      const group = dayGroups.find((day) =>
        day.options.some((option) => option.value === initialSlotId),
      );
      if (group) {
        setSelectedDayKey(group.dayKey);
        setSelectedSlotId(initialSlotId);
        return;
      }
    }
    const firstDay = dayGroups[0]?.dayKey ?? "";
    const firstSlot = dayGroups[0]?.options[0]?.value ?? "";
    setSelectedDayKey(firstDay);
    setSelectedSlotId(firstSlot);
  }, [dayGroups, initialSlotId]);

  const slotsForDay = useMemo(() => {
    return dayGroups.find((group) => group.dayKey === selectedDayKey)?.options ?? [];
  }, [dayGroups, selectedDayKey]);

  useEffect(() => {
    if (slotsForDay.some((option) => option.value === selectedSlotId)) {
      return;
    }
    setSelectedSlotId(slotsForDay[0]?.value ?? "");
  }, [slotsForDay, selectedSlotId]);

  const timeLabel = (option: StepOption): string => {
    const slot = availableTimeslots.find((entry) => entry.id === option.value);
    return slot ? formatTimeslotTimeOnly(slot.startTime) : option.label;
  };

  if (dayGroups.length === 0) {
    return (
      <div className="step-enter rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground">
          No timeslots available right now
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try again in a moment or pick a different day range in chat.
        </p>
      </div>
    );
  }

  const selectedTimeLabel = slotsForDay.find(
    (option) => option.value === selectedSlotId,
  );

  return (
    <div className="flex w-fit max-w-full min-w-0 flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
      <p className="text-sm font-medium">Choose appointment time</p>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label className="text-xs">Day</Label>
        <div className="flex min-w-0 max-w-sm flex-wrap gap-2">
          {dayGroups.map((day) => (
            <Button
              key={day.dayKey}
              type="button"
              size="sm"
              variant={selectedDayKey === day.dayKey ? "default" : "outline"}
              className="h-8 max-w-full truncate px-3"
              disabled={loading}
              onClick={() => setSelectedDayKey(day.dayKey)}
            >
              {day.dayLabel}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex w-fit min-w-0 flex-col gap-1.5">
        <Label htmlFor="timeslot-time" className="text-xs">
          Time
        </Label>
        <Select
          value={selectedSlotId}
          onValueChange={setSelectedSlotId}
          disabled={loading || slotsForDay.length === 0}
        >
          <SelectTrigger
            id="timeslot-time"
            size="sm"
            className="w-56 max-w-full bg-background"
            aria-label={
              selectedTimeLabel
                ? `Selected time ${timeLabel(selectedTimeLabel)}`
                : "Select a time"
            }
          >
            <SelectValue placeholder="Select a time" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            sideOffset={4}
            style={
              {
                "--popover": "var(--background)",
                "--popover-foreground": "var(--foreground)",
              } as CSSProperties
            }
            className={cn(
              "z-50 !max-h-60 w-56 min-w-[8rem] overflow-y-auto rounded-md border shadow-md ring-0",
              "!bg-background !text-foreground",
              "before:hidden [&::before]:hidden",
              "[&_[data-slot=select-scroll-up-button]]:!bg-background",
              "[&_[data-slot=select-scroll-down-button]]:!bg-background",
            )}
          >
            {slotsForDay.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="!text-foreground focus:!bg-accent focus:!text-accent-foreground data-[highlighted]:!bg-accent data-[highlighted]:!text-accent-foreground data-[state=checked]:!bg-accent data-[state=checked]:!text-accent-foreground"
              >
                {timeLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        size="sm"
        className="w-fit"
        disabled={loading || !selectedSlotId}
        onClick={() => onConfirm(selectedSlotId)}
      >
        Use this time
      </Button>
    </div>
  );
}

export function PartyForm({
  step,
  loading,
  onSubmit,
  initialValues,
  suggestedFields,
  suggestedFieldLabels,
  submitLabel = "Save details",
}: {
  step: FormStep;
  loading: boolean;
  onSubmit: (values: Record<string, string>) => void;
  initialValues?: Record<string, string>;
  /** Prefilled fields — shown with subtle suggestion styling. */
  suggestedFields?: string[];
  suggestedFieldLabels?: Record<string, string>;
  submitLabel?: string;
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      step.fields.map((field) => [
        field.name,
        initialValues?.[field.name] ?? field.defaultValue ?? "",
      ]),
    ),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const suggestedFieldSet = useMemo(
    () => new Set(suggestedFields ?? []),
    [suggestedFields],
  );

  const formValid = useMemo(
    () => isPartyFormValid(values, step.fields),
    [values, step.fields],
  );

  const handleChange = (field: FormField, value: string) => {
    setValues((prev) => ({ ...prev, [field.name]: value }));
    setFieldErrors((prev) => {
      if (!prev[field.name]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field.name];
      return next;
    });
  };

  const validateField = (field: FormField) => {
    const errors = validatePartyFormFields(values, [field]);
    const message = errors[field.name];
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[field.name] = message;
      } else {
        delete next[field.name];
      }
      return next;
    });
  };

  const applyAddressSuggestion = (suggestion: AddressSuggestion) => {
    setValues((prev) => ({
      ...prev,
      address: suggestion.address || prev.address || "",
      zipCode: suggestion.zipCode || prev.zipCode || "",
      city: suggestion.city || prev.city || "",
      stateProvince: suggestion.stateProvince || prev.stateProvince || "",
      countryCode: suggestion.countryCode || prev.countryCode || "",
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validatePartyFormFields(values, step.fields);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setTouched(
        Object.fromEntries(step.fields.map((field) => [field.name, true])),
      );
      return;
    }
    onSubmit(values);
  };

  const inputTypeForField = (field: FormField): string => {
    if (field.name === "email") {
      return "email";
    }
    if (field.name === "phoneNumber") {
      return "tel";
    }
    return field.type;
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <p className="text-sm font-medium">{step.title}</p>
      {step.error ? (
        <p className="text-sm text-destructive">{step.error}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {step.fields.map((field) => {
          if (
            (field.name === "companyName" || field.name === "vat") &&
            !isBusinessBillingSelected(values)
          ) {
            return null;
          }

          if (field.type === "checkbox") {
            const checked = isBusinessBillingSelected(values);
            return (
              <div
                key={field.name}
                className="flex min-w-0 items-center gap-2 sm:col-span-2"
              >
                <input
                  id={`${step.accessor}-${field.name}`}
                  type="checkbox"
                  checked={checked}
                  disabled={loading}
                  onChange={(event) =>
                    handleChange(field, event.target.checked ? "true" : "false")
                  }
                  className="size-4 rounded border border-input"
                />
                <Label
                  htmlFor={`${step.accessor}-${field.name}`}
                  className="text-xs font-normal"
                >
                  {field.label}
                </Label>
              </div>
            );
          }

          return (
          <div
            key={field.name}
            className={cn(
              "flex min-w-0 flex-col gap-1.5",
              field.name === "address" && "sm:col-span-2",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Label htmlFor={`${step.accessor}-${field.name}`} className="text-xs">
                {field.label}
                {(field.required ||
                  (field.name === "companyName" &&
                    isBusinessBillingSelected(values))) ? (
                  " *"
                ) : null}
              </Label>
              {suggestedFieldSet.has(field.name) ? (
                <span className="text-[10px] font-medium text-primary">
                  {suggestedFieldLabels?.[field.name] ?? "From your document"}
                </span>
              ) : null}
            </div>
            {field.name === "address" ? (
              <AddressAutocompleteInput
                id={`${step.accessor}-${field.name}`}
                required={field.required}
                value={values[field.name] ?? ""}
                disabled={loading}
                inputClassName={
                  suggestedFieldSet.has(field.name)
                    ? "border-primary/30 bg-primary/5"
                    : undefined
                }
                onChange={(next) => handleChange(field, next)}
                onSelect={applyAddressSuggestion}
              />
            ) : (
              <div className="relative min-w-0">
                {field.name === "phoneNumber" &&
                phoneFlagOrPlaceholder(values[field.name] ?? "") ? (
                  <span
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base"
                    aria-hidden
                  >
                    {phoneFlagOrPlaceholder(values[field.name] ?? "")}
                  </span>
                ) : null}
                <Input
                  id={`${step.accessor}-${field.name}`}
                  type={inputTypeForField(field)}
                  required={field.required}
                  value={values[field.name] ?? ""}
                  onChange={(event) => handleChange(field, event.target.value)}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, [field.name]: true }));
                    if (
                      field.name === "email" ||
                      field.name === "phoneNumber" ||
                      field.name === "companyName" ||
                      field.required
                    ) {
                      validateField(field);
                    }
                  }}
                  disabled={loading}
                  aria-invalid={Boolean(fieldErrors[field.name])}
                  aria-describedby={
                    fieldErrors[field.name]
                      ? `${step.accessor}-${field.name}-error`
                      : undefined
                  }
                  className={cn(
                    "min-w-0",
                    field.name === "phoneNumber" &&
                      phoneFlagOrPlaceholder(values[field.name] ?? "")
                      ? "pl-10"
                      : undefined,
                    suggestedFieldSet.has(field.name) &&
                      "border-primary/30 bg-primary/5",
                  )}
                />
              </div>
            )}
            {fieldErrors[field.name] && touched[field.name] ? (
              <p
                id={`${step.accessor}-${field.name}-error`}
                className="text-xs text-destructive"
                role="alert"
              >
                {fieldErrors[field.name]}
              </p>
            ) : null}
          </div>
          );
        })}
      </div>
      <Button
        type="submit"
        disabled={loading || !formValid}
        className="w-full sm:w-auto"
        aria-disabled={loading || !formValid}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

function snapshotFromClient(args: {
  engineState: EngineState | null;
  messages: ChatMessage[];
  options: StepOption[] | undefined;
  formStep: FormStep | null;
  participantsStep: ParticipantsStep | null;
  datePickerStep: DatePickerStep | null;
  fileUploadStep: FileUploadStep | null;
  currentAccessor: string | undefined;
  runningPrice: number | undefined;
  finished: boolean;
  fileNames: string[];
}): ChatSnapshot {
  return { ...args };
}

function reportChatError(message: string): string {
  const friendly = friendlyErrorMessage(new Error(message));
  toast.error("Could not continue", { description: friendly });
  return friendly;
}

export function Chat({
  onComplete,
  resumeFrom,
  onResumeHandled,
  onSessionProgress,
}: ChatProps): React.ReactElement {
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<StepOption[] | undefined>();
  const [formStep, setFormStep] = useState<FormStep | null>(null);
  const [participantsStep, setParticipantsStep] =
    useState<ParticipantsStep | null>(null);
  const [datePickerStep, setDatePickerStep] = useState<DatePickerStep | null>(
    null,
  );
  const [fileUploadStep, setFileUploadStep] = useState<FileUploadStep | null>(
    null,
  );
  const [currentAccessor, setCurrentAccessor] = useState<string | undefined>();
  const [runningPrice, setRunningPrice] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuickReply, setSelectedQuickReply] = useState<string | null>(
    null,
  );
  const [finished, setFinished] = useState(false);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [docSeedComplete, setDocSeedComplete] = useState(false);
  const [ocrPartyPrefill, setOcrPartyPrefill] = useState<OcrParty | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);
  const [ocrReading, setOcrReading] = useState(false);
  const [docUploadHardError, setDocUploadHardError] = useState<string | null>(
    null,
  );
  const [engineUploadChecking, setEngineUploadChecking] = useState(false);
  const [engineUploadHardError, setEngineUploadHardError] = useState<
    string | null
  >(null);
  const [engineUploadWarning, setEngineUploadWarning] =
    useState<UploadContentWarning | null>(null);
  const [pendingEngineUpload, setPendingEngineUpload] = useState<File | null>(
    null,
  );
  const [pendingOcr, setPendingOcr] = useState<{
    result: OcrResponse;
    file: File;
    countryConfirmed: boolean;
  } | null>(null);
  const uploadedFilesRef = useRef<File[]>([]);
  const sessionFileOwnersRef = useRef<Record<string, string>>({});
  const bootstrapped = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const formStepRef = useRef<HTMLDivElement>(null);
  const participantsStepRef = useRef<HTMLDivElement>(null);
  const datePickerStepRef = useRef<HTMLDivElement>(null);
  const timeslotStepRef = useRef<HTMLDivElement>(null);
  const fileUploadStepRef = useRef<HTMLDivElement>(null);
  const ocrPanelRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevFormAccessorRef = useRef<string | null>(null);
  const prevTimeslotPickerRef = useRef(false);
  const prevFileUploadStepRef = useRef<string | null>(null);
  const prevPendingOcrRef = useRef(false);
  const historyStackRef = useRef<ChatSnapshot[]>([]);
  const accessorSnapshotsRef = useRef<Record<string, ChatSnapshot>>({});
  const pendingSnapshotRef = useRef<ChatSnapshot | null>(null);

  const captureSnapshot = useCallback((): ChatSnapshot => {
    return snapshotFromClient({
      engineState,
      messages,
      options,
      formStep,
      participantsStep,
      datePickerStep,
      fileUploadStep,
      currentAccessor,
      runningPrice,
      finished,
      fileNames: uploadedFilesRef.current.map((file) => file.name),
    });
  }, [
    engineState,
    messages,
    options,
    formStep,
    participantsStep,
    datePickerStep,
    fileUploadStep,
    currentAccessor,
    runningPrice,
    finished,
  ]);

  const restoreSnapshot = useCallback(
    (snapshot: ChatSnapshot) => {
      setEngineState(snapshot.engineState);
      sessionFileOwnersRef.current = {
        ...(snapshot.engineState?.sessionFileOwners ?? {}),
      };
      setMessages(snapshot.messages);
      setOptions(snapshot.options);
      setFormStep(snapshot.formStep);
      setParticipantsStep(snapshot.participantsStep);
      setDatePickerStep(snapshot.datePickerStep);
      setFileUploadStep(snapshot.fileUploadStep);
      setCurrentAccessor(snapshot.currentAccessor);
      setRunningPrice(snapshot.runningPrice);
      setFinished(snapshot.finished);
      setError(null);
      setInput("");
      uploadedFilesRef.current = uploadedFilesRef.current.filter((file) =>
        snapshot.fileNames.includes(file.name),
      );
      if (!snapshot.finished) {
        onComplete(null);
      }
    },
    [onComplete],
  );

  const handleBack = useCallback(() => {
    const previous = historyStackRef.current.pop();
    if (!previous) {
      return;
    }
    setHistoryDepth(historyStackRef.current.length);
    restoreSnapshot(previous);
  }, [restoreSnapshot]);

  const applyStep = useCallback(
    (response: ChatResponse, recordHistory: boolean) => {
      if (recordHistory && pendingSnapshotRef.current) {
        historyStackRef.current.push(pendingSnapshotRef.current);
        pendingSnapshotRef.current = null;
        setHistoryDepth(historyStackRef.current.length);
      }

      setEngineState(response.state);
      setMessages(response.state.messages);
      if (response.state.sessionFileOwners) {
        sessionFileOwnersRef.current = {
          ...response.state.sessionFileOwners,
        };
      }

      if (response.step.type === "complete") {
        setFinished(true);
        setOptions(undefined);
        setFormStep(null);
        setParticipantsStep(null);
        setDatePickerStep(null);
        setFileUploadStep(null);
        setCurrentAccessor(undefined);
        setRunningPrice(undefined);
        onComplete({
          payload: response.step.payload,
          lineItems: response.state.pricing?.lineItems ?? [],
          confirmedPrice: response.step.payload.confirmedPrice,
          files: uploadedFilesRef.current.filter((file) => file.size > 0),
          availableTimeslots: response.state.availableTimeslots,
          engineState: response.state,
        });
        return;
      }

      if (response.step.type === "form") {
        setFormStep(response.step);
        setParticipantsStep(null);
        setDatePickerStep(null);
        setFileUploadStep(null);
        setCurrentAccessor(response.step.accessor);
        setOptions(undefined);
        setRunningPrice(response.step.euroTotal);
        accessorSnapshotsRef.current[response.step.accessor] =
          snapshotFromClient({
            engineState: response.state,
            messages: response.state.messages,
            options: undefined,
            formStep: response.step,
            participantsStep: null,
            datePickerStep: null,
            fileUploadStep: null,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
        return;
      }

      if (response.step.type === "participants") {
        setFormStep(null);
        setParticipantsStep(response.step);
        setDatePickerStep(null);
        setFileUploadStep(null);
        setCurrentAccessor(response.step.accessor);
        setOptions(undefined);
        setRunningPrice(response.step.euroTotal);
        accessorSnapshotsRef.current[response.step.accessor] =
          snapshotFromClient({
            engineState: response.state,
            messages: response.state.messages,
            options: undefined,
            formStep: null,
            participantsStep: response.step,
            datePickerStep: null,
            fileUploadStep: null,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
        return;
      }

      if (response.step.type === "fileUpload") {
        setFormStep(null);
        setParticipantsStep(null);
        setDatePickerStep(null);
        setFileUploadStep(response.step);
        setCurrentAccessor(response.step.accessor);
        setOptions(undefined);
        setRunningPrice(response.step.euroTotal);
        accessorSnapshotsRef.current[response.step.accessor] =
          snapshotFromClient({
            engineState: response.state,
            messages: response.state.messages,
            options: undefined,
            formStep: null,
            participantsStep: null,
            datePickerStep: null,
            fileUploadStep: response.step,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
        return;
      }

      if (response.step.type === "datePicker") {
        setFormStep(null);
        setParticipantsStep(null);
        setDatePickerStep(response.step);
        setFileUploadStep(null);
        setCurrentAccessor(response.step.accessor);
        setOptions(undefined);
        setRunningPrice(response.step.euroTotal);
        accessorSnapshotsRef.current[response.step.accessor] =
          snapshotFromClient({
            engineState: response.state,
            messages: response.state.messages,
            options: undefined,
            formStep: null,
            participantsStep: null,
            datePickerStep: response.step,
            fileUploadStep: null,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
        return;
      }

      if (response.step.type === "ask") {
        setFormStep(null);
        setParticipantsStep(null);
        setDatePickerStep(null);
        setFileUploadStep(null);
        setCurrentAccessor(response.step.accessor);
        setOptions(response.step.options);
        setRunningPrice(response.step.euroTotal);
        accessorSnapshotsRef.current[response.step.accessor] =
          snapshotFromClient({
            engineState: response.state,
            messages: response.state.messages,
            options: response.step.options,
            formStep: null,
            participantsStep: null,
            datePickerStep: null,
            fileUploadStep: null,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
      }
    },
    [onComplete],
  );

  const postChat = useCallback(
    async (
      payload: {
        userMessage: string;
        structuredAnswer?: Record<string, unknown>;
        uploadProductId?: string;
        uploadKind?: "file";
      },
      options?: {
        stateOverride?: EngineState | null;
        recordHistory?: boolean;
        manageLoading?: boolean;
      },
    ): Promise<ChatResponse | null> => {
      const manageLoading = options?.manageLoading ?? true;
      if (manageLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        if (options?.recordHistory ?? true) {
          pendingSnapshotRef.current = captureSnapshot();
          setRememberedEmail((current) =>
            captureRememberedEmail(
              current,
              payload.userMessage,
              payload.structuredAnswer,
            ),
          );
        }

        const activeState = options?.stateOverride ?? engineState;
        const sessionFiles = uploadedFilesRef.current.map((file) => file.name);
        const sessionFileOwners = sessionFileOwnersRef.current;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: activeState
              ? { ...activeState, sessionFiles, sessionFileOwners }
              : activeState,
            userMessage: payload.userMessage,
            structuredAnswer: payload.structuredAnswer,
            uploadProductId: payload.uploadProductId,
            uploadKind: payload.uploadKind,
            sessionFiles,
            sessionFileOwners,
          }),
        });

        const data = (await response.json()) as ChatResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Chat request failed");
        }

        applyStep(
          data,
          (options?.recordHistory ?? true) &&
            Boolean(payload.userMessage || payload.structuredAnswer),
        );
        return data;
      } catch (err) {
        pendingSnapshotRef.current = null;
        const friendly = reportChatError(
          err instanceof Error ? err.message : "Something went wrong",
        );
        setError(friendly);
        return null;
      } finally {
        if (manageLoading) {
          setLoading(false);
        }
      }
    },
    [engineState, applyStep, captureSnapshot],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      await postChat({ userMessage: text });
    },
    [postChat],
  );

  const sendStructuredAnswer = useCallback(
    async (values: Record<string, unknown>) => {
      await postChat({ userMessage: "", structuredAnswer: values });
    },
    [postChat],
  );

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    void sendMessage("");
  }, [sendMessage]);

  const showTimeslotPicker =
    currentAccessor === "timeslots" &&
    Boolean(options?.length) &&
    !datePickerStep &&
    !engineState?.timeslotFallback &&
    !loading &&
    !finished &&
    !formStep &&
    !participantsStep;

  useEffect(() => {
    const scrollTimer = window.setTimeout(() => {
      const container = messagesContainerRef.current;
      const overflow = contentOverflows(container);

      if (participantsStep) {
        if (overflow) {
          scrollIntoStep(participantsStepRef.current, "nearest");
        }
        return;
      }

      if (datePickerStep) {
        if (overflow) {
          scrollIntoStep(datePickerStepRef.current, "nearest");
        }
        return;
      }

      if (formStep) {
        const accessor = formStep.accessor;
        if (accessor !== prevFormAccessorRef.current) {
          prevFormAccessorRef.current = accessor;
          if (overflow) {
            scrollIntoStep(formStepRef.current, "nearest");
          }
        }
        return;
      }
      prevFormAccessorRef.current = null;

      if (showTimeslotPicker) {
        if (!prevTimeslotPickerRef.current) {
          prevTimeslotPickerRef.current = true;
          if (overflow) {
            scrollIntoStep(timeslotStepRef.current, "nearest");
          }
        }
        return;
      }
      prevTimeslotPickerRef.current = false;

      if (fileUploadStep) {
        const productId = fileUploadStep.productId;
        if (productId !== prevFileUploadStepRef.current) {
          prevFileUploadStepRef.current = productId;
          if (overflow) {
            scrollIntoStep(fileUploadStepRef.current, "nearest");
          }
        }
        return;
      }
      prevFileUploadStepRef.current = null;

      if (pendingOcr) {
        if (!prevPendingOcrRef.current) {
          prevPendingOcrRef.current = true;
          if (overflow) {
            scrollIntoStep(ocrPanelRef.current, "nearest");
          }
        }
        return;
      }
      prevPendingOcrRef.current = false;

      const messageCount = messages.length;
      const newMessages = messageCount > prevMessageCountRef.current;
      prevMessageCountRef.current = messageCount;

      if (newMessages && lastMessageRef.current && overflow) {
        scrollIntoStep(lastMessageRef.current, "nearest");
      }
    }, 0);

    return () => window.clearTimeout(scrollTimer);
  }, [
    messages,
    formStep,
    participantsStep,
    datePickerStep,
    fileUploadStep,
    pendingOcr,
    showTimeslotPicker,
  ]);

  useEffect(() => {
    onSessionProgress?.({
      collected: engineState?.collected ?? {},
      finished,
    });
  }, [engineState?.collected, finished, onSessionProgress]);

  useEffect(() => {
    setSelectedQuickReply(null);
  }, [currentAccessor, options]);

  useEffect(() => {
    setEngineUploadHardError(null);
    setEngineUploadWarning(null);
    setPendingEngineUpload(null);
    setEngineUploadChecking(false);
  }, [fileUploadStep?.productId]);

  useEffect(() => {
    if (!resumeFrom) {
      return;
    }
    setEngineState(resumeFrom.state);
    setMessages(resumeFrom.state.messages);
    setFinished(false);
    setError(null);
    setInput("");
    onComplete(null);

    if (resumeFrom.step.type === "complete") {
      setFinished(true);
      setOptions(undefined);
      setFormStep(null);
      setCurrentAccessor(undefined);
      setRunningPrice(undefined);
      onComplete({
        payload: resumeFrom.step.payload,
        lineItems: resumeFrom.state.pricing?.lineItems ?? [],
        confirmedPrice: resumeFrom.step.payload.confirmedPrice,
        files: uploadedFilesRef.current.filter((file) => file.size > 0),
        availableTimeslots: resumeFrom.state.availableTimeslots,
        engineState: resumeFrom.state,
      });
    } else if (resumeFrom.step.type === "form") {
      setFormStep(resumeFrom.step);
      setParticipantsStep(null);
      setDatePickerStep(null);
      setFileUploadStep(null);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else if (resumeFrom.step.type === "participants") {
      setFormStep(null);
      setParticipantsStep(resumeFrom.step);
      setDatePickerStep(null);
      setFileUploadStep(null);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else if (resumeFrom.step.type === "fileUpload") {
      setFormStep(null);
      setParticipantsStep(null);
      setDatePickerStep(null);
      setFileUploadStep(resumeFrom.step);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else if (resumeFrom.step.type === "datePicker") {
      setFormStep(null);
      setParticipantsStep(null);
      setDatePickerStep(resumeFrom.step);
      setFileUploadStep(null);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else {
      setFormStep(null);
      setParticipantsStep(null);
      setDatePickerStep(null);
      setFileUploadStep(null);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(resumeFrom.step.options);
      setRunningPrice(resumeFrom.step.euroTotal);
    }

    onResumeHandled?.();
  }, [resumeFrom, onResumeHandled, onComplete]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (
      !trimmed ||
      loading ||
      finished ||
      formStep ||
      participantsStep ||
      datePickerStep ||
      fileUploadStep
    ) {
      return;
    }
    setInput("");
    void sendMessage(trimmed);
  };

  const handleQuickReply = (option: StepOption) => {
    if (
      loading ||
      finished ||
      formStep ||
      participantsStep ||
      datePickerStep ||
      fileUploadStep
    ) {
      return;
    }
    setSelectedQuickReply(option.value);
    void sendMessage(option.value);
  };

  const commitEngineFileUpload = useCallback(
    (file: File, productId: string) => {
      uploadedFilesRef.current = [
        ...uploadedFilesRef.current.filter((entry) => entry.name !== file.name),
        file,
      ];
      sessionFileOwnersRef.current = {
        ...sessionFileOwnersRef.current,
        [file.name]: productId,
      };
      void postChat({
        userMessage: file.name,
        uploadProductId: productId,
        uploadKind: "file",
      });
    },
    [postChat],
  );

  const resetEngineUploadState = useCallback(() => {
    setEngineUploadHardError(null);
    setEngineUploadWarning(null);
    setPendingEngineUpload(null);
    setEngineUploadChecking(false);
  }, []);

  const handleEngineFileUpload = useCallback(
    async (file: File) => {
      if (!file || loading || finished || !fileUploadStep || engineUploadChecking) {
        return;
      }

      resetEngineUploadState();
      setEngineUploadChecking(true);

      try {
        const formData = new FormData();
        formData.append("file", file, file.name);

        const response = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as OcrResponse & {
          error?: string;
        };

        if (!response.ok) {
          setEngineUploadHardError(
            data.error ?? "That doesn't look like a valid PDF.",
          );
          return;
        }

        const mismatch = detectOcrContentMismatch(
          data,
          fileUploadStep.productId,
          fileUploadStep.productLabel,
        );

        if (mismatch) {
          setPendingEngineUpload(file);
          setEngineUploadWarning({
            message: mismatch.message,
            detectedProductTitle: mismatch.detectedProductTitle,
          });
          return;
        }

        commitEngineFileUpload(file, fileUploadStep.productId);
      } catch (err) {
        setEngineUploadHardError(
          err instanceof Error
            ? err.message
            : "Could not check that file — try again.",
        );
      } finally {
        setEngineUploadChecking(false);
      }
    },
    [
      commitEngineFileUpload,
      engineUploadChecking,
      fileUploadStep,
      finished,
      loading,
      resetEngineUploadState,
    ],
  );

  const handleEngineUploadUseAnyway = useCallback(() => {
    if (!pendingEngineUpload || !fileUploadStep || loading || finished) {
      return;
    }
    const file = pendingEngineUpload;
    const productId = fileUploadStep.productId;
    resetEngineUploadState();
    commitEngineFileUpload(file, productId);
  }, [
    commitEngineFileUpload,
    fileUploadStep,
    finished,
    loading,
    pendingEngineUpload,
    resetEngineUploadState,
  ]);

  const finishOcrProduct = useCallback(
    async (
      activeState: EngineState,
      file: File,
      product: { id: string; title: string },
    ): Promise<boolean> => {
      sessionFileOwnersRef.current = {
        ...sessionFileOwnersRef.current,
        [file.name]: product.id,
      };

      const productRes = await postChat(
        { userMessage: product.title },
        { stateOverride: activeState, recordHistory: true, manageLoading: false },
      );
      if (!productRes) {
        return false;
      }

      if (
        productRes.step.type === "fileUpload" &&
        productRes.step.productId === product.id
      ) {
        await postChat(
          {
            userMessage: file.name,
            uploadProductId: product.id,
            uploadKind: "file",
          },
          { stateOverride: productRes.state, recordHistory: true, manageLoading: false },
        );
      }

      return true;
    },
    [postChat],
  );

  const processDocumentUpload = useCallback(
    async (file: File) => {
      if (loading || finished || ocrReading || !engineState) {
        return;
      }

      setOcrReading(true);
      setDocUploadHardError(null);
      setError(null);
      setPendingOcr(null);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: `Uploaded ${file.name}` },
        { role: "assistant", content: "Reading your document…" },
      ]);

      try {
        const formData = new FormData();
        formData.append("file", file, file.name);

        const response = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as OcrResponse & {
          error?: string;
          notice?: string;
        };

        if (!response.ok) {
          if (data.error) {
            setDocUploadHardError(data.error);
            setMessages((prev) =>
              prev.filter(
                (message) => message.content !== "Reading your document…",
              ),
            );
            setPendingOcr(null);
            return;
          }

          const partyPrefill = normalizeOcrParty(data.extracted?.party);
          if (partyPrefill) {
            setOcrPartyPrefill(partyPrefill);
          }

          const softMessage =
            data.notice ??
            "I couldn't read much from that document — let's fill it in together.";
          uploadedFilesRef.current = [
            ...uploadedFilesRef.current.filter(
              (entry) => entry.name !== file.name,
            ),
            file,
          ];
          setMessages((prev) => {
            const withoutReading = prev.filter(
              (message) => message.content !== "Reading your document…",
            );
            return [
              ...withoutReading,
              { role: "assistant", content: softMessage },
            ];
          });
          setPendingOcr(null);
          setDocSeedComplete(true);
          return;
        }

        uploadedFilesRef.current = [
          ...uploadedFilesRef.current.filter((entry) => entry.name !== file.name),
          file,
        ];

        const partyPrefill = normalizeOcrParty(data.extracted?.party);
        if (partyPrefill) {
          setOcrPartyPrefill(partyPrefill);
        }

        const assistantMessage = formatOcrSummary(data, file.name);

        setMessages((prev) => {
          const withoutReading = prev.filter(
            (message) => message.content !== "Reading your document…",
          );
          return [
            ...withoutReading,
            {
              role: "assistant",
              content: assistantMessage,
            },
          ];
        });

        if (data.notice || !hasConfirmableOcr(data)) {
          setPendingOcr(null);
          setDocSeedComplete(true);
          return;
        }

        setPendingOcr({ result: data, file, countryConfirmed: false });
      } catch (err) {
        setMessages((prev) =>
          prev.filter((message) => message.content !== "Reading your document…"),
        );
        const friendly = reportChatError(
          err instanceof Error ? err.message : "Could not read document",
        );
        setError(friendly);
        toast.message("Couldn't read the doc", {
          description: "Let's fill it in together — type your answers below.",
        });
      } finally {
        setOcrReading(false);
      }
    },
    [engineState, finished, loading, ocrReading],
  );

  const handleOcrCountry = useCallback(
    async (country: { code: string; label: string }) => {
      if (!pendingOcr || !engineState) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const inferred = pendingOcr.result.destinationCountry;
        const countryMessage = `${country.label} (${country.code})`;

        const countryRes = await postChat(
          { userMessage: countryMessage },
          { stateOverride: engineState, recordHistory: true, manageLoading: false },
        );
        if (!countryRes) {
          return;
        }

        if (inferred && country.code !== inferred) {
          setPendingOcr(null);
          setDocSeedComplete(true);
          return;
        }

        if (!pendingOcr.result.productOptions?.length) {
          setPendingOcr(null);
          setDocSeedComplete(true);
          return;
        }

        setPendingOcr((current) =>
          current
            ? { ...current, countryConfirmed: true }
            : null,
        );
      } finally {
        setLoading(false);
      }
    },
    [engineState, pendingOcr, postChat],
  );

  const handleOcrProduct = useCallback(
    async (product: { id: string; title: string }) => {
      if (!pendingOcr || !engineState) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let activeState = engineState;
        const { result: ocr, file, countryConfirmed } = pendingOcr;

        if (ocr.destinationCountry && !countryConfirmed) {
          const countryRes = await postChat(
            {
              userMessage: countryQuickReplyValue(
                ocr.destinationCountry,
                ocr.destinationCountryLabel,
                options,
              ),
            },
            { stateOverride: activeState, recordHistory: true, manageLoading: false },
          );
          if (!countryRes) {
            return;
          }
          activeState = countryRes.state;
        }

        const ok = await finishOcrProduct(activeState, file, product);
        if (ok) {
          setPendingOcr(null);
          setDocSeedComplete(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [engineState, finishOcrProduct, options, pendingOcr, postChat],
  );

  const supportedCountries = useMemo(
    () =>
      engineState?.form
        ? getSupportedDestinationCountries(engineState.form)
        : [],
    [engineState?.form],
  );

  const partyFormPrefill = useMemo(() => {
    if (!formStep) {
      return undefined;
    }
    return buildPartyFormPrefill(
      ocrPartyPrefill ?? undefined,
      rememberedEmail,
      formStep.fields,
    );
  }, [formStep, ocrPartyPrefill, rememberedEmail]);

  const participantEmailSuggestion = useMemo(
    () =>
      primaryParticipantEmailSuggestion({
        rememberedEmail,
        ocrParty: ocrPartyPrefill ?? undefined,
      }),
    [rememberedEmail, ocrPartyPrefill],
  );

  const showCountryPickerStep =
    currentAccessor === "destinationCountry" &&
    !finished &&
    !pendingOcr &&
    !formStep &&
    !participantsStep &&
    !datePickerStep &&
    !fileUploadStep;

  const handleManualCountrySelect = useCallback(
    (country: { code: string; label: string }) => {
      if (loading || finished) {
        return;
      }
      void sendMessage(
        countryQuickReplyValue(country.code, country.label, options),
      );
    },
    [finished, loading, options, sendMessage],
  );

  const showQuickReplies =
    Boolean(options?.length) &&
    !pendingOcr &&
    !loading &&
    !finished &&
    !formStep &&
    !participantsStep &&
    !datePickerStep &&
    !fileUploadStep &&
    currentAccessor !== "timeslots" &&
    currentAccessor !== "destinationCountry";

  const showEmptyState = messages.length === 0 && loading;
  const showDocUpload =
    !finished &&
    !docSeedComplete &&
    !pendingOcr &&
    (currentAccessor === "destinationCountry" ||
      (messages.length <= 3 && !finished));
  const canGoBack = historyDepth > 0 && !loading;

  const selectedFileForUpload = fileUploadStep
    ? (pendingEngineUpload ??
      uploadedFilesRef.current.find(
        (file) =>
          sessionFileOwnersRef.current[file.name] === fileUploadStep.productId,
      ) ??
      null)
    : null;

  const showHero =
    showDocUpload && !finished && messages.length <= 2 && !pendingOcr;

  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-2xl py-0 shadow-sm [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
      <CardHeader className="shrink-0 border-b border-border bg-card pb-4 pt-(--card-spacing)">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-lg font-semibold tracking-tight">
              Assistant
            </CardTitle>
            <CardDescription className="leading-relaxed">
              Answer naturally — we&apos;ll build your booking from the live form
              schema.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canGoBack && !finished && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 tap-press"
                onClick={handleBack}
                disabled={loading}
                aria-label="Go back to previous step"
              >
                Back
              </Button>
            )}
            {runningPrice !== undefined && !finished && (
              <Badge
                variant="secondary"
                className="border-primary/15 bg-primary/8 tabular-nums text-foreground"
              >
                €{runningPrice.toFixed(2)}
              </Badge>
            )}
            {finished && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                Ready to review
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-4 px-4 pb-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="flex min-w-0 flex-col gap-3 pt-6">
            {showEmptyState && (
              <HeroLanding loading className="step-enter" />
            )}

            {showHero && !showEmptyState && (
              <HeroLanding className="step-enter" />
            )}

            {showDocUpload && (
              <AssistantStepRow className="step-enter">
                <DocumentUploadZone
                  disabled={loading || ocrReading || !engineState}
                  busy={ocrReading}
                  hardError={docUploadHardError}
                  onFile={(file) => void processDocumentUpload(file)}
                />
              </AssistantStepRow>
            )}

            {messages.map((message, index) => {
              const fileMeta = uploadedFilesRef.current.find(
                (file) =>
                  message.content === file.name ||
                  message.content === `Uploaded ${file.name}`,
              );

              return (
                <ChatMessageBubble
                  key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                  role={message.role}
                  content={message.content}
                  index={index}
                  attachmentSizeBytes={fileMeta?.size}
                  innerRef={
                    index === messages.length - 1 ? lastMessageRef : undefined
                  }
                />
              );
            })}

            {pendingOcr && !finished && (
              <AssistantStepRow innerRef={ocrPanelRef}>
                <OcrConfirmPanel
                  ocr={pendingOcr.result}
                  loading={loading}
                  countryConfirmed={pendingOcr.countryConfirmed}
                  supportedCountries={supportedCountries}
                  onCountry={(country) => void handleOcrCountry(country)}
                  onProduct={(product) => void handleOcrProduct(product)}
                  onSkip={() => {
                    setPendingOcr(null);
                    setDocSeedComplete(true);
                  }}
                />
              </AssistantStepRow>
            )}

            {formStep && !finished && (
              <AssistantStepRow
                innerRef={formStepRef}
                className="step-enter"
              >
                <PartyForm
                  key={formStep.accessor}
                  step={formStep}
                  loading={loading}
                  initialValues={partyFormPrefill?.defaults}
                  suggestedFields={partyFormPrefill?.suggestedFields}
                  suggestedFieldLabels={partyFormPrefill?.suggestedFieldLabels}
                  onSubmit={(values) => void sendStructuredAnswer(values)}
                />
              </AssistantStepRow>
            )}

            {participantsStep && !finished && (
              <AssistantStepRow
                innerRef={participantsStepRef}
                className="step-enter"
              >
                <ParticipantsForm
                  step={participantsStep}
                  loading={loading}
                  primaryEmailSuggestion={participantEmailSuggestion}
                  onSubmit={(values) => void sendStructuredAnswer(values)}
                />
              </AssistantStepRow>
            )}

            {datePickerStep && !finished && (
              <AssistantStepRow
                innerRef={datePickerStepRef}
                className="step-enter"
              >
                <AppointmentDatePicker
                  step={datePickerStep}
                  loading={loading}
                  onSubmit={(date) => void sendStructuredAnswer({ date })}
                />
              </AssistantStepRow>
            )}

            {showCountryPickerStep && (
              <AssistantStepRow className="step-enter">
                <CountrySearchSelect
                  countries={supportedCountries}
                  loading={loading}
                  onSelect={handleManualCountrySelect}
                />
              </AssistantStepRow>
            )}

            {showTimeslotPicker && options && engineState?.availableTimeslots && (
              <AssistantStepRow
                innerRef={timeslotStepRef}
                className="step-enter"
              >
                <TimeslotPicker
                  options={options}
                  availableTimeslots={engineState.availableTimeslots}
                  loading={loading}
                  onConfirm={(slotId) => void sendMessage(slotId)}
                />
              </AssistantStepRow>
            )}

            {fileUploadStep && !finished && (
              <AssistantStepRow
                innerRef={fileUploadStepRef}
                className="step-enter scroll-mt-4"
              >
                <InlineFileUploadCard
                  productLabel={fileUploadStep.productLabel}
                  loading={loading}
                  checking={engineUploadChecking}
                  selectedFile={selectedFileForUpload}
                  hardError={engineUploadHardError}
                  contentWarning={engineUploadWarning}
                  onFile={(file) => void handleEngineFileUpload(file)}
                  onUseAnyway={handleEngineUploadUseAnyway}
                  onReplace={resetEngineUploadState}
                />
              </AssistantStepRow>
            )}

            {loading && messages.length > 0 && <TypingIndicator />}

            {error && (
              <div
                role="alert"
                className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive break-words [overflow-wrap:anywhere]"
              >
                {error}
              </div>
            )}

        </div>
      </div>

      {showQuickReplies && options && (
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Quick replies
            </p>
            <div className="flex min-w-0 max-h-36 flex-wrap gap-2 overflow-y-auto overscroll-contain">
              {options
                .filter((option) => option.label !== "Auto-added product")
                .slice(0, 12)
                .map((option) => {
                  const selected = selectedQuickReply === option.value;
                  const countryCode = extractCountryCodeFromOption(
                    option.value,
                    option.label,
                  );
                  const flag = countryCode ? countryFlag(countryCode) : "";
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "tap-press h-auto min-h-11 min-w-0 max-w-full whitespace-normal break-words py-2 text-left [overflow-wrap:anywhere]",
                        selected && "ring-2 ring-primary",
                      )}
                      disabled={loading || selected}
                      aria-pressed={selected}
                      onClick={() => handleQuickReply(option)}
                    >
                      {flag ? (
                        <span className="mr-1.5" aria-hidden>
                          {flag}
                        </span>
                      ) : null}
                      {option.label}
                    </Button>
                  );
                })}
            </div>
        </div>
      )}

      <CardFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <form
          onSubmit={handleSubmit}
          className="flex w-full min-w-0 items-center"
        >
          <div
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-full border border-border bg-background py-1 pl-3 pr-1 shadow-sm",
              "focus-within:ring-2 focus-within:ring-primary/25 focus-within:ring-offset-0",
            )}
          >
            <Input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                finished
                  ? "Booking complete"
                  : fileUploadStep
                    ? "Use the upload card above…"
                    : formStep || participantsStep || datePickerStep
                      ? "Use the form above…"
                      : showTimeslotPicker
                        ? "Pick a time above…"
                        : datePickerStep
                          ? "Pick a date above…"
                          : showDocUpload
                          ? "Type an answer or attach a document…"
                          : "Type your answer…"
              }
              disabled={
                loading ||
                finished ||
                Boolean(formStep) ||
                Boolean(participantsStep) ||
                Boolean(datePickerStep) ||
                Boolean(fileUploadStep) ||
                showTimeslotPicker
              }
              className="min-h-9 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
              aria-label="Message"
            />
            <Button
              type="submit"
              disabled={
                loading ||
                finished ||
                Boolean(formStep) ||
                Boolean(participantsStep) ||
                Boolean(datePickerStep) ||
                Boolean(fileUploadStep) ||
                showTimeslotPicker ||
                !input.trim()
              }
              className="tap-press min-h-9 shrink-0 rounded-full px-4"
            >
              Send
            </Button>
          </div>
        </form>
      </CardFooter>

      {finished && (
        <div className="shrink-0 border-t border-primary/15 bg-primary/5 px-4 py-3 text-center text-sm text-muted-foreground">
          All set — review the summary and click{" "}
          <strong className="text-foreground">Book it</strong> to submit in
          debug mode.
        </div>
      )}
    </Card>
  );
}
