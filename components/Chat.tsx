"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import type { PriceLineItem } from "@/lib/notarity-api";
import { validatePartyFormValues } from "@/lib/field-validation";
import { formatOcrSummary } from "@/lib/ocr-summary";
import type { OcrResponse } from "@/lib/ocr-types";
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

type ChatSnapshot = {
  engineState: EngineState | null;
  messages: ChatMessage[];
  options: StepOption[] | undefined;
  formStep: FormStep | null;
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
};

type ChatResponse = {
  step: EngineStep;
  state: EngineState;
};

type FormStep = Extract<EngineStep, { type: "form" }>;
type FileUploadStep = Extract<EngineStep, { type: "fileUpload" }>;

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
  onChange,
  onSelect,
}: {
  id: string;
  value: string;
  disabled: boolean;
  required?: boolean;
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
        className="min-w-0"
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

function scrollToBottom(element: HTMLDivElement | null): void {
  if (!element) return;
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  element.scrollIntoView({
    block: "end",
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

const COUNTRY_FLAG: Record<string, string> = {
  ES: "🇪🇸",
  AT: "🇦🇹",
};

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
  onCountry,
  onProduct,
  onSkip,
}: {
  ocr: OcrResponse;
  loading: boolean;
  countryConfirmed: boolean;
  onCountry: (country: { code: string; label: string }) => void;
  onProduct: (product: { id: string; title: string }) => void;
  onSkip: () => void;
}): React.ReactElement {
  const showProducts =
    Boolean(ocr.productOptions?.length) &&
    (countryConfirmed || !ocr.countryOptions?.length);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
      {ocr.countryOptions && ocr.countryOptions.length > 0 && !countryConfirmed && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Destination country</p>
          <div className="flex flex-wrap gap-2">
            {ocr.countryOptions.map((country) => {
              const suggested = country.code === ocr.destinationCountry;
              const flag = COUNTRY_FLAG[country.code] ?? "";
              return (
                <Button
                  key={country.code}
                  type="button"
                  size="sm"
                  variant={suggested ? "default" : "outline"}
                  disabled={loading}
                  className="h-auto min-w-0 max-w-full whitespace-normal py-1.5"
                  onClick={() => onCountry(country)}
                >
                  {country.label} ({country.code}){flag ? ` ${flag}` : ""}
                  {suggested ? " · suggested" : ""}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {showProducts && ocr.productOptions && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Booking product</p>
          <div className="flex flex-wrap gap-2">
            {ocr.productOptions.map((product) => {
              const isSuggested = product.id === ocr.suggestedProductId;
              const isAlternative = ocr.alternativeProductIds?.includes(
                product.id,
              );
              return (
                <Button
                  key={product.id}
                  type="button"
                  size="sm"
                  variant={isSuggested ? "default" : "outline"}
                  disabled={loading}
                  className="h-auto min-w-0 max-w-full whitespace-normal py-1.5 text-left"
                  onClick={() => onProduct(product)}
                >
                  {product.title}
                  {isSuggested ? " · suggested" : ""}
                  {isAlternative ? " · also possible" : ""}
                </Button>
              );
            })}
          </div>
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
  onFile,
}: {
  disabled: boolean;
  busy: boolean;
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
        "flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/30",
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
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {busy ? "Reading your document…" : "Start with your document"}
        </p>
        <p className="max-w-[18rem] text-xs text-muted-foreground">
          Drop a PDF or image here and we&apos;ll infer the country and document
          type to speed up booking.
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
        accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
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

function TypingIndicator(): React.ReactElement {
  return (
    <div
      className="flex min-w-0 items-center gap-2 px-1"
      role="status"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      <div className="flex gap-1 motion-reduce:hidden">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-muted-foreground motion-reduce:font-medium">
        Typing…
      </span>
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
      <p className="text-sm text-muted-foreground">No available timeslots.</p>
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
  submitLabel = "Save details",
}: {
  step: FormStep;
  loading: boolean;
  onSubmit: (values: Record<string, string>) => void;
  initialValues?: Record<string, string>;
  submitLabel?: string;
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      step.fields.map((f) => [f.name, initialValues?.[f.name] ?? ""]),
    ),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
    const errors = validatePartyFormValues(values, [field]);
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
    const errors = validatePartyFormValues(values, step.fields);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    onSubmit(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4"
    >
      <p className="text-sm font-medium">{step.title}</p>
      {step.error ? (
        <p className="text-sm text-destructive">{step.error}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {step.fields.map((field) => (
          <div
            key={field.name}
            className={cn(
              "flex min-w-0 flex-col gap-1.5",
              field.name === "address" && "sm:col-span-2",
            )}
          >
            <Label htmlFor={`${step.accessor}-${field.name}`} className="text-xs">
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {field.name === "address" ? (
              <AddressAutocompleteInput
                id={`${step.accessor}-${field.name}`}
                required={field.required}
                value={values[field.name] ?? ""}
                disabled={loading}
                onChange={(next) => handleChange(field, next)}
                onSelect={applyAddressSuggestion}
              />
            ) : (
              <Input
                id={`${step.accessor}-${field.name}`}
                type={field.type}
                required={field.required}
                value={values[field.name] ?? ""}
                onChange={(event) => handleChange(field, event.target.value)}
                onBlur={() => {
                  if (field.name === "email" || field.name === "phoneNumber") {
                    validateField(field);
                  }
                }}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors[field.name])}
                className="min-w-0"
              />
            )}
            {fieldErrors[field.name] ? (
              <p className="text-xs text-destructive">{fieldErrors[field.name]}</p>
            ) : null}
          </div>
        ))}
      </div>
      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
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
  fileUploadStep: FileUploadStep | null;
  currentAccessor: string | undefined;
  runningPrice: number | undefined;
  finished: boolean;
  fileNames: string[];
}): ChatSnapshot {
  return { ...args };
}

export function Chat({
  onComplete,
  resumeFrom,
  onResumeHandled,
}: ChatProps): React.ReactElement {
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<StepOption[] | undefined>();
  const [formStep, setFormStep] = useState<FormStep | null>(null);
  const [fileUploadStep, setFileUploadStep] = useState<FileUploadStep | null>(
    null,
  );
  const [currentAccessor, setCurrentAccessor] = useState<string | undefined>();
  const [runningPrice, setRunningPrice] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [docSeedComplete, setDocSeedComplete] = useState(false);
  const [ocrReading, setOcrReading] = useState(false);
  const [pendingOcr, setPendingOcr] = useState<{
    result: OcrResponse;
    file: File;
    countryConfirmed: boolean;
  } | null>(null);
  const uploadedFilesRef = useRef<File[]>([]);
  const sessionFileOwnersRef = useRef<Record<string, string>>({});
  const bootstrapped = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyStackRef = useRef<ChatSnapshot[]>([]);
  const accessorSnapshotsRef = useRef<Record<string, ChatSnapshot>>({});
  const pendingSnapshotRef = useRef<ChatSnapshot | null>(null);

  const captureSnapshot = useCallback((): ChatSnapshot => {
    return snapshotFromClient({
      engineState,
      messages,
      options,
      formStep,
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
            fileUploadStep: response.step,
            currentAccessor: response.step.accessor,
            runningPrice: response.step.euroTotal,
            finished: false,
            fileNames: uploadedFilesRef.current.map((file) => file.name),
          });
        return;
      }

      setFormStep(null);
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
          fileUploadStep: null,
          currentAccessor: response.step.accessor,
          runningPrice: response.step.euroTotal,
          finished: false,
          fileNames: uploadedFilesRef.current.map((file) => file.name),
        });
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
        setError(err instanceof Error ? err.message : "Something went wrong");
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
    async (values: Record<string, string>) => {
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

  useEffect(() => {
    scrollToBottom(bottomRef.current);
  }, [messages, loading, formStep, fileUploadStep]);

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
      setFileUploadStep(null);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else if (resumeFrom.step.type === "fileUpload") {
      setFormStep(null);
      setFileUploadStep(resumeFrom.step);
      setCurrentAccessor(resumeFrom.step.accessor);
      setOptions(undefined);
      setRunningPrice(resumeFrom.step.euroTotal);
    } else {
      setFormStep(null);
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
    if (!trimmed || loading || finished || formStep || fileUploadStep) {
      return;
    }
    setInput("");
    void sendMessage(trimmed);
  };

  const handleQuickReply = (option: StepOption) => {
    if (loading || finished || formStep || fileUploadStep) {
      return;
    }
    void sendMessage(option.value);
  };

  const handleEngineFileUpload = useCallback(
    (file: File) => {
      if (!file || loading || finished || !fileUploadStep) {
        return;
      }
      uploadedFilesRef.current = [
        ...uploadedFilesRef.current.filter((entry) => entry.name !== file.name),
        file,
      ];
      sessionFileOwnersRef.current = {
        ...sessionFileOwnersRef.current,
        [file.name]: fileUploadStep.productId,
      };
      void postChat({
        userMessage: file.name,
        uploadProductId: fileUploadStep.productId,
        uploadKind: "file",
      });
    },
    [fileUploadStep, finished, loading, postChat],
  );

  const processDocumentUpload = useCallback(
    async (file: File) => {
      if (loading || finished || ocrReading || !engineState) {
        return;
      }

      setOcrReading(true);
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
        setError(err instanceof Error ? err.message : "Could not read document");
      } finally {
        setOcrReading(false);
      }
    },
    [engineState, finished, loading, ocrReading],
  );

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

  const showTimeslotPicker =
    currentAccessor === "timeslots" &&
    Boolean(options?.length) &&
    !loading &&
    !finished &&
    !formStep;

  const showQuickReplies =
    Boolean(options?.length) &&
    !pendingOcr &&
    !loading &&
    !finished &&
    !formStep &&
    !fileUploadStep &&
    currentAccessor !== "timeslots";

  const showEmptyState = messages.length === 0 && loading;
  const showDocUpload =
    !finished &&
    !docSeedComplete &&
    !pendingOcr &&
    (currentAccessor === "destinationCountry" ||
      (messages.length <= 3 && !finished));
  const showAttachButton =
    !finished && !loading && Boolean(fileUploadStep);
  const canGoBack = historyDepth > 0 && !loading;

  const handleAttachFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || loading || finished || !fileUploadStep) {
      return;
    }
    handleEngineFileUpload(file);
  };

  return (
    <Card className="flex h-full min-h-[20rem] flex-col shadow-sm lg:min-h-0">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>Chat</CardTitle>
            <CardDescription>
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
                onClick={handleBack}
                disabled={loading}
              >
                Back
              </Button>
            )}
            {runningPrice !== undefined && !finished && (
              <Badge variant="outline" className="tabular-nums">
                €{runningPrice.toFixed(2)}
              </Badge>
            )}
            {finished && <Badge>Complete</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="flex min-w-0 flex-col gap-3">
            {showEmptyState && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <span className="text-4xl" aria-hidden>
                  👋
                </span>
                <p className="max-w-[16rem] text-sm text-muted-foreground">
                  Starting your booking assistant…
                </p>
                <div className="flex w-full max-w-xs flex-col gap-2">
                  <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-10 w-3/4 motion-reduce:animate-none" />
                </div>
              </div>
            )}

            {showDocUpload && (
              <DocumentUploadZone
                disabled={loading || ocrReading || !engineState}
                busy={ocrReading}
                onFile={(file) => void processDocumentUpload(file)}
              />
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "flex min-w-0",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "min-w-0 max-w-[80%] break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {pendingOcr && !finished && (
              <OcrConfirmPanel
                ocr={pendingOcr.result}
                loading={loading}
                countryConfirmed={pendingOcr.countryConfirmed}
                onCountry={(country) => void handleOcrCountry(country)}
                onProduct={(product) => void handleOcrProduct(product)}
                onSkip={() => {
                  setPendingOcr(null);
                  setDocSeedComplete(true);
                }}
              />
            )}

            {formStep && !finished && (
              <div className="flex min-w-0 justify-start">
                <PartyForm
                  step={formStep}
                  loading={loading}
                  onSubmit={(values) => void sendStructuredAnswer(values)}
                />
              </div>
            )}

            {showTimeslotPicker && options && engineState?.availableTimeslots && (
              <div className="flex min-w-0 justify-start">
                <TimeslotPicker
                  options={options}
                  availableTimeslots={engineState.availableTimeslots}
                  loading={loading}
                  onConfirm={(slotId) => void sendMessage(slotId)}
                />
              </div>
            )}

            {loading && messages.length > 0 && <TypingIndicator />}

            {error && (
              <div
                role="alert"
                className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words [overflow-wrap:anywhere]"
              >
                {error}
              </div>
            )}

            <div ref={bottomRef} className="h-px shrink-0" />
          </div>
        </div>

        {showQuickReplies && options && (
          <div className="shrink-0 border-t border-border px-4 py-3">
            <div className="flex min-w-0 max-h-32 flex-wrap gap-2 overflow-y-auto overscroll-contain">
              {options
                .filter((option) => option.label !== "Auto-added product")
                .slice(0, 12)
                .map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-w-0 max-w-full whitespace-normal break-words py-1.5 text-left [overflow-wrap:anywhere]"
                    onClick={() => handleQuickReply(option)}
                  >
                    {option.label}
                  </Button>
                ))}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card">
        <div className="flex w-full min-w-0 items-center gap-2 sm:flex-row">
          {showAttachButton && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={loading}
              asChild
            >
              <label className="cursor-pointer">
                Attach
                <input
                  key={fileUploadStep!.productId}
                  type="file"
                  accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={loading}
                  onChange={handleAttachFileChange}
                />
              </label>
            </Button>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex w-full min-w-0 flex-1 items-center gap-2"
          >
          <Input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              finished
                ? "Booking complete"
                : fileUploadStep
                  ? `Attach the document for ${fileUploadStep.productLabel}…`
                  : formStep
                    ? "Use the form above…"
                    : showTimeslotPicker
                      ? "Pick a time above…"
                      : showDocUpload
                        ? "Type an answer or attach a document…"
                        : "Type your answer…"
            }
            disabled={
              loading ||
              finished ||
              Boolean(formStep) ||
              Boolean(fileUploadStep) ||
              showTimeslotPicker
            }
            className="min-w-0 flex-1"
            aria-label="Message"
          />
          <Button
            type="submit"
            disabled={
              loading ||
              finished ||
              Boolean(formStep) ||
              Boolean(fileUploadStep) ||
              showTimeslotPicker ||
              !input.trim()
            }
            className="shrink-0"
          >
            Send
          </Button>
          </form>
        </div>
      </CardFooter>

      {finished && (
        <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
          All set — review the summary and click <strong>Book it</strong> to
          submit in debug mode.
        </div>
      )}
    </Card>
  );
}
