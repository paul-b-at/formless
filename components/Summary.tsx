"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PartyForm, TimeslotPicker, type CompleteBooking } from "@/components/Chat";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PARTY_FORM_FIELDS, type EngineState, type EngineStep } from "@/lib/engine";
import {
  buildPriceDisplay,
  centsToEuros,
} from "@/lib/price-display";
import { getCountryOptions } from "@/lib/form-interpreter";
import type { PriceLineItem } from "@/lib/notarity-api";
import {
  buildTimeslotOptions,
  formatTimeslotLabel,
} from "@/lib/timeslot-format";

type SummaryProps = {
  booking: CompleteBooking;
  onBookingUpdate: (booking: CompleteBooking) => void;
  onReask: (resume: { state: EngineState; step: EngineStep }) => void;
};

type BookResult = {
  confirmedPrice: number;
  lineItems: PriceLineItem[];
  result: unknown;
};

function productLabel(id: string, lineItems: PriceLineItem[]): string {
  return lineItems.find((item) => item._product === id)?.name ?? id;
}

function SectionHeader({
  title,
  accessor,
  onEdit,
  editing,
}: {
  title: string;
  accessor?: string;
  onEdit?: (accessor: string) => void;
  editing?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {accessor && onEdit && !editing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onEdit(accessor)}
        >
          Edit
        </Button>
      )}
    </div>
  );
}

export function Summary({
  booking,
  onBookingUpdate,
  onReask,
}: SummaryProps): React.ReactElement {
  const { payload, lineItems, confirmedPrice, files, availableTimeslots, engineState } =
    booking;

  const [submitting, setSubmitting] = useState(false);
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [editingAccessor, setEditingAccessor] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const priceDisplay = useMemo(() => buildPriceDisplay(lineItems), [lineItems]);

  const countryOptions = useMemo(
    () =>
      getCountryOptions(engineState.form).map((country) => ({
        label: `${country.label} (${country.code})`,
        value: country.code,
      })),
    [engineState.form],
  );

  const timeslotOptions = useMemo(() => {
    if (!availableTimeslots?.length) {
      return [];
    }
    return buildTimeslotOptions(availableTimeslots);
  }, [availableTimeslots]);

  const applyEdit = async (accessor: string, value: unknown) => {
    setEditLoading(true);
    setEditError(null);

    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: engineState,
          accessor,
          value,
        }),
      });

      const data = (await response.json()) as {
        step: EngineStep;
        state: EngineState;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Edit failed");
      }

      if (data.step.type === "complete") {
        onBookingUpdate({
          payload: data.step.payload,
          lineItems: data.state.pricing?.lineItems ?? lineItems,
          confirmedPrice: data.step.payload.confirmedPrice,
          files,
          availableTimeslots: data.state.availableTimeslots,
          engineState: data.state,
        });
        setEditingAccessor(null);
        toast.success("Updated", { description: "Summary refreshed in place." });
        return;
      }

      setEditingAccessor(null);
      onReask({ state: data.state, step: data.step });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Edit failed";
      setEditError(message);
      toast.error("Could not save edit", { description: message });
    } finally {
      setEditLoading(false);
    }
  };

  const timeslotLabel = useMemo(() => {
    const slotId = payload.timeslots[0];
    if (!slotId) {
      return "—";
    }
    const slot = availableTimeslots?.find((entry) => entry.id === slotId);
    if (slot) {
      return formatTimeslotLabel(slot.startTime);
    }
    return slotId;
  }, [availableTimeslots, payload.timeslots]);

  const handleBook = async () => {
    setSubmitting(true);
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
      toast.success("Appointment request submitted", {
        description: `Confirmed price: €${data.confirmedPrice.toFixed(2)} (debug mode)`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Booking failed";
      setBookError(message);
      toast.error("Booking failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const renderInlineEditor = (accessor: string): React.ReactElement | null => {
    if (editingAccessor !== accessor) {
      return null;
    }

    if (accessor === "destinationCountry") {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {countryOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={
                payload.destinationCountry === option.value ? "default" : "outline"
              }
              disabled={editLoading}
              onClick={() => void applyEdit(accessor, option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={editLoading}
            onClick={() => setEditingAccessor(null)}
          >
            Cancel
          </Button>
        </div>
      );
    }

    if (accessor === "timeslots" && timeslotOptions.length > 0 && availableTimeslots) {
      return (
        <div className="mt-3">
          <TimeslotPicker
            options={timeslotOptions}
            availableTimeslots={availableTimeslots}
            loading={editLoading}
            initialSlotId={payload.timeslots[0]}
            onConfirm={(slotId) => void applyEdit(accessor, [slotId])}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={editLoading}
            onClick={() => setEditingAccessor(null)}
          >
            Cancel
          </Button>
        </div>
      );
    }

    if (accessor === "hardCopy") {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={payload.hardCopy.hardCopy ? "default" : "outline"}
            disabled={editLoading}
            onClick={() =>
              void applyEdit(accessor, { hardCopy: true, expressShipping: false })
            }
          >
            Yes, send a hard copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!payload.hardCopy.hardCopy ? "default" : "outline"}
            disabled={editLoading}
            onClick={() =>
              void applyEdit(accessor, { hardCopy: false, expressShipping: false })
            }
          >
            No hard copy needed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={editLoading}
            onClick={() => setEditingAccessor(null)}
          >
            Cancel
          </Button>
        </div>
      );
    }

    if (
      accessor === "billingDetails" ||
      (accessor === "shippingDetails" && payload.shippingDetails)
    ) {
      const party =
        accessor === "billingDetails"
          ? payload.billingDetails
          : payload.shippingDetails!;
      const initialValues: Record<string, string> = {
        firstName: party.firstName ?? "",
        lastName: party.lastName ?? "",
        email: party.email ?? "",
        phoneNumber: party.phoneNumber ?? "",
        address: party.address ?? "",
        zipCode: party.zipCode ?? "",
        city: party.city ?? "",
        stateProvince: party.stateProvince ?? "",
        countryCode: party.countryCode ?? "",
      };

      return (
        <div className="mt-3">
          <PartyForm
            step={{
              type: "form",
              accessor,
              title:
                accessor === "billingDetails" ? "Billing details" : "Shipping address",
              fields: PARTY_FORM_FIELDS,
            }}
            loading={editLoading}
            initialValues={initialValues}
            submitLabel="Save change"
            onSubmit={(values) => {
              const structured =
                accessor === "shippingDetails"
                  ? {
                      shippingDetailsSameAsBillingDetails: false,
                      ...values,
                      business: false,
                    }
                  : { ...values, business: party.business ?? false };
              void applyEdit(accessor, structured);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={editLoading}
            onClick={() => setEditingAccessor(null)}
          >
            Cancel
          </Button>
        </div>
      );
    }

    return (
      <p className="mt-2 text-xs text-muted-foreground">
        This field cannot be edited inline yet — use Back in chat.
      </p>
    );
  };

  const startEdit = (accessor: string) => {
    setEditError(null);
    setEditingAccessor(accessor);
  };

  return (
    <Card className="flex h-full min-h-[20rem] flex-col shadow-sm lg:min-h-0">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Review &amp; book</CardTitle>
            <CardDescription>
              Server-priced breakdown — submit only when you&apos;re ready.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{payload.destinationCountry}</Badge>
            <Badge variant="outline">{payload.mode}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full max-h-[min(28rem,50dvh)] lg:max-h-none">
          <div className="flex flex-col gap-4 px-4 py-4">
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/60 p-3">
                <SectionHeader
                  title="Destination"
                  accessor="destinationCountry"
                  onEdit={startEdit}
                  editing={editingAccessor === "destinationCountry"}
                />
                <p className="mt-1 font-medium text-foreground">
                  {payload.destinationCountry}
                </p>
                {renderInlineEditor("destinationCountry")}
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <SectionHeader
                  title="Timeslot"
                  accessor="timeslots"
                  onEdit={startEdit}
                  editing={editingAccessor === "timeslots"}
                />
                <p className="mt-1 font-medium text-foreground">
                  {timeslotLabel}
                </p>
                {renderInlineEditor("timeslots")}
              </div>
            </section>

            <section className="rounded-xl bg-muted/60 p-3">
              <SectionHeader
                title="Products"
                accessor="products"
                onEdit={startEdit}
                editing={editingAccessor === "products"}
              />
              {renderInlineEditor("products")}
              <ul className="mt-2 space-y-2">
                {payload.products.map((product) => (
                  <li key={product.id} className="text-sm text-foreground">
                    <span className="font-medium">
                      {productLabel(product.id, lineItems)}
                    </span>
                    {product.files.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {product.files.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl bg-muted/60 p-3">
              <SectionHeader
                title="Billing contact"
                accessor="billingDetails"
                onEdit={startEdit}
                editing={editingAccessor === "billingDetails"}
              />
              {renderInlineEditor("billingDetails")}
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {payload.billingDetails.firstName}{" "}
                {payload.billingDetails.lastName}
                <br />
                {payload.billingDetails.email}
                <br />
                <span className="text-muted-foreground">
                  {payload.billingDetails.address}, {payload.billingDetails.city}{" "}
                  {payload.billingDetails.zipCode}
                </span>
              </p>
            </section>

            {payload.hardCopy.hardCopy && (
              <section className="rounded-xl bg-muted/60 p-3">
                <SectionHeader
                  title="Shipping"
                  accessor="shippingDetails"
                  onEdit={startEdit}
                  editing={editingAccessor === "shippingDetails"}
                />
                {renderInlineEditor("shippingDetails")}
                <p className="mt-1 text-sm text-foreground">
                  {payload.shippingDetails?.address},{" "}
                  {payload.shippingDetails?.city}{" "}
                  {payload.shippingDetails?.zipCode}
                </p>
              </section>
            )}

            <section className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Price breakdown
              </p>
              {priceDisplay.lines.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {priceDisplay.lines.map((line, index) => (
                    <li
                      key={`${line.name}-${index}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-foreground">{line.name}</span>
                      <span className="shrink-0 tabular-nums font-medium">
                        €{centsToEuros(line.netCents).toFixed(2)}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
                    <span className="text-muted-foreground">Subtotal (net)</span>
                    <span className="shrink-0 tabular-nums font-medium">
                      €{centsToEuros(priceDisplay.netTotalCents).toFixed(2)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">VAT</span>
                    <span className="shrink-0 tabular-nums font-medium">
                      €{centsToEuros(priceDisplay.taxTotalCents).toFixed(2)}
                    </span>
                  </li>
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Total confirmed from server pricing.
                </p>
              )}
              <div className="mt-4 space-y-1 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Total (incl. VAT)
                  </span>
                  <span className="text-xl font-bold tabular-nums text-primary">
                    €{centsToEuros(priceDisplay.grossTotalCents).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{priceDisplay.vatNote}</p>
                <p className="text-xs text-muted-foreground">
                  Submitted confirmed price (net): €{confirmedPrice.toFixed(2)}
                </p>
              </div>
            </section>

            {editError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {editError}
              </div>
            )}

            {files.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {files.length} file(s) attached:{" "}
                {files.map((f) => f.name).join(", ")}
              </p>
            )}

            {bookError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {bookError}
              </div>
            )}

            {bookResult && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm">
                <p className="font-semibold text-foreground">
                  Submitted successfully (debug mode)
                </p>
                <p className="mt-1 text-muted-foreground">
                  Confirmed price: €{bookResult.confirmedPrice.toFixed(2)}
                </p>
                <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                  {JSON.stringify(bookResult.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="flex-col gap-2 border-t border-border">
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => void handleBook()}
          disabled={submitting || bookResult !== null || editingAccessor !== null}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-4 rounded-full motion-reduce:animate-none" />
              Submitting…
            </span>
          ) : bookResult ? (
            "Submitted"
          ) : (
            "Book it"
          )}
        </Button>
        <p className="w-full text-center text-xs text-muted-foreground">
          draft: {payload._appointmentRequestDraft}
        </p>
      </CardFooter>
    </Card>
  );
}
