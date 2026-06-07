"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import {
  BookingSuccess,
  referenceIdFromBookResult,
} from "@/components/BookingSuccess";
import { countryFlag, countryLabelWithFlag } from "@/components/country-display";
import { FileAttachmentList } from "@/components/FileAttachmentChip";
import {
  bookingErrorDetailsToText,
  formatZodIssues,
  type BookingErrorDetails,
} from "@/lib/booking-errors";
import { AppointmentRequest } from "@/lib/booking-schema";
import { sanitizeAppointmentPayload } from "@/lib/party-sanitize";
import { ZodError } from "zod";
import { PartyForm, TimeslotPicker, type CompleteBooking } from "@/components/Chat";
import { ProductEditPanel } from "@/components/ProductEditPanel";
import {
  buildSessionFileOwnersForProductEdit,
  mergeBookingFilesForProductEdit,
  type ProductEditResult,
} from "@/components/product-edit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  getPartyFormFieldsForAccessor,
  parsePartyStructuredAnswer,
  type EngineState,
  type EngineStep,
} from "@/lib/engine";
import { getConsentConfig } from "@/lib/consent-config";
import { autoAttachSessionFiles } from "@/lib/form-interpreter";
import {
  buildPriceDisplay,
  centsToEuros,
} from "@/lib/price-display";
import { getCountryOptions } from "@/lib/form-interpreter";
import type { PriceLineItem } from "@/lib/notarity";
import {
  buildTimeslotOptions,
  formatTimeslotLabel,
} from "@/lib/timeslot-format";

type SummaryProps = {
  booking: CompleteBooking;
  onBookingUpdate: (booking: CompleteBooking) => void;
  onReask: (resume: { state: EngineState; step: EngineStep }) => void;
  onBooked?: () => void;
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
  onBooked,
}: SummaryProps): React.ReactElement {
  const { payload, lineItems, confirmedPrice, files, availableTimeslots, engineState } =
    booking;

  const [submitting, setSubmitting] = useState(false);
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookErrorDetails, setBookErrorDetails] = useState<string | null>(null);
  const [editingAccessor, setEditingAccessor] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const consentConfig = useMemo(
    () => getConsentConfig(engineState.form, engineState.collected),
    [engineState.collected, engineState.form],
  );

  const [newsletterOptIn, setNewsletterOptIn] = useState(
    () => engineState.collected.newsletter ?? payload.newsletter ?? false,
  );
  const [termsAccepted, setTermsAccepted] = useState(
    () => engineState.collected.termsAccepted === true,
  );
  const [consentError, setConsentError] = useState<string | null>(null);

  const priceDisplay = useMemo(() => buildPriceDisplay(lineItems), [lineItems]);

  const consentBlocked =
    consentConfig.termsRequired && termsAccepted !== true;

  const fileSizes = useMemo(
    () => Object.fromEntries(files.map((file) => [file.name, file.size])),
    [files],
  );

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

  const applyEdit = async (
    accessor: string,
    value: unknown,
    options?: { state?: EngineState; files?: File[] },
  ) => {
    setEditLoading(true);
    setEditError(null);

    const stateForEdit = options?.state ?? engineState;
    const filesForBooking = options?.files ?? files;

    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: stateForEdit,
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
          files: filesForBooking,
          availableTimeslots: data.state.availableTimeslots,
          engineState: data.state,
        });
        setEditingAccessor(null);
        toast.success("Updated", { description: "Summary refreshed in place." });
        return;
      }

      if (data.step.type === "fileUpload") {
        setEditError(
          `${data.step.productLabel} needs a document. Upload it in the chat, then return to review.`,
        );
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

  const applyProductsEdit = async (result: ProductEditResult) => {
    const mergedFiles = mergeBookingFilesForProductEdit(
      files,
      result.newFiles,
      result.removedFileNames,
    );
    const sessionFiles = mergedFiles.map((file) => file.name);
    const sessionFileOwners = buildSessionFileOwnersForProductEdit(
      result.filesByProductId,
    );

    await applyEdit("products", result.products, {
      state: {
        ...engineState,
        sessionFiles,
        sessionFileOwners,
      },
      files: mergedFiles,
    });
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
    if (consentBlocked) {
      setConsentError("Please accept the terms and conditions before booking.");
      return;
    }

    setSubmitting(true);
    setBookError(null);
    setBookErrorDetails(null);
    setConsentError(null);

    try {
      const syncedCollected = autoAttachSessionFiles(
        engineState.form,
        payload,
        engineState.productCatalog ?? [],
        files.map((file) => file.name),
        engineState.sessionFileOwners ?? {},
      );
      const payloadWithFiles = {
        ...payload,
        products: syncedCollected.products ?? payload.products,
        newsletter: consentConfig.showNewsletter
          ? newsletterOptIn
          : (payload.newsletter ?? false),
      };

      let validatedPayload: AppointmentRequest;
      try {
        validatedPayload = AppointmentRequest.parse(
          sanitizeAppointmentPayload(payloadWithFiles),
        );
      } catch (error) {
        if (error instanceof ZodError) {
          const details: BookingErrorDetails = {
            kind: "zod",
            issues: formatZodIssues(error),
          };
          const detailsText = bookingErrorDetailsToText(details);
          setBookError("Booking payload is invalid — fix the fields below.");
          setBookErrorDetails(detailsText);
          toast.error("Booking failed", {
            description: "Payload validation failed before submit.",
          });
          return;
        }
        throw error;
      }

      const formData = new FormData();
      formData.append("payload", JSON.stringify(validatedPayload));

      for (const file of files) {
        formData.append("files", file, file.name);
      }

      for (const product of validatedPayload.products) {
        for (const fileName of product.files) {
          if (!files.some((f) => f.name === fileName)) {
            const message = `Missing upload for required file: ${fileName}. Please upload the PDF during the chat.`;
            setBookError("A required document is missing.");
            setBookErrorDetails(message);
            toast.error("Booking failed", { description: message });
            return;
          }
        }
      }

      const response = await fetch("/api/book", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as BookResult & {
        error?: string;
        details?: BookingErrorDetails;
      };

      if (!response.ok) {
        const detailsText = bookingErrorDetailsToText(data.details);
        setBookError(
          data.error ?? "We couldn't submit your booking. Please try again.",
        );
        setBookErrorDetails(detailsText);
        toast.error("Booking failed", {
          description: data.error ?? "See details in the summary panel.",
        });
        return;
      }

      setBookResult(data);
      onBooked?.();
      toast.success("You're booked!", {
        description: `€${priceDisplay.grossTotalCents ? (priceDisplay.grossTotalCents / 100).toFixed(2) : data.confirmedPrice.toFixed(2)} confirmed (debug mode)`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't submit your booking. Please try again.";
      setBookError("We couldn't submit your booking. Please try again.");
      setBookErrorDetails(message);
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
              {countryFlag(option.value) ? (
                <span className="mr-1.5" aria-hidden>
                  {countryFlag(option.value)}
                </span>
              ) : null}
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

    if (accessor === "products") {
      const catalog = engineState.productCatalog ?? [];
      if (catalog.length === 0) {
        return (
          <p className="mt-2 text-xs text-muted-foreground">
            Product catalog unavailable — use Back in chat.
          </p>
        );
      }

      return (
        <ProductEditPanel
          catalog={catalog}
          currentProducts={payload.products}
          bookingFiles={files}
          loading={editLoading}
          onConfirm={(result) => void applyProductsEdit(result)}
          onCancel={() => setEditingAccessor(null)}
        />
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
      const partyFields = getPartyFormFieldsForAccessor(
        engineState.form,
        accessor,
        engineState.collected,
        engineState.productCatalog ?? [],
      );
      const initialValues: Record<string, string> = {
        business: party.business ? "true" : "false",
        firstName: party.firstName ?? "",
        lastName: party.lastName ?? "",
        email: party.email ?? "",
        phoneNumber: party.phoneNumber ?? "",
        address: party.address ?? "",
        zipCode: party.zipCode ?? "",
        city: party.city ?? "",
        stateProvince: party.stateProvince ?? "",
        countryCode: party.countryCode ?? "",
        companyName: party.businessDetails?.companyName ?? "",
        vat: party.businessDetails?.vat ?? "",
      };

      return (
        <div className="mt-3">
          <PartyForm
            step={{
              type: "form",
              accessor,
              title:
                accessor === "billingDetails" ? "Billing details" : "Shipping address",
              fields: partyFields,
            }}
            loading={editLoading}
            initialValues={initialValues}
            submitLabel="Save change"
            onSubmit={(values) => {
              const base =
                accessor === "shippingDetails"
                  ? {
                      shippingDetailsSameAsBillingDetails: false,
                      ...values,
                      business: false,
                    }
                  : values;
              void applyEdit(accessor, parsePartyStructuredAnswer(base));
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

  const referenceId = bookResult
    ? referenceIdFromBookResult(bookResult.result)
    : null;

  if (bookResult) {
    return (
      <Card className="flex h-full min-h-0 flex-col shadow-sm">
        <CardContent className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
          <BookingSuccess
            confirmedPrice={bookResult.confirmedPrice}
            grossTotalCents={priceDisplay.grossTotalCents}
            destinationCountry={payload.destinationCountry}
            countryLabel={countryLabelWithFlag(payload.destinationCountry)}
            timeslotLabel={timeslotLabel}
            referenceId={referenceId}
            className="w-full"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col shadow-sm">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">
              Review &amp; book
            </CardTitle>
            <CardDescription className="leading-relaxed">
              Server-priced breakdown — submit only when you&apos;re ready.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-primary/8">
              {countryLabelWithFlag(payload.destinationCountry)}
            </Badge>
            <Badge variant="outline">{payload.mode}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-4 py-4">
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
                <SectionHeader
                  title="Destination"
                  accessor="destinationCountry"
                  onEdit={startEdit}
                  editing={editingAccessor === "destinationCountry"}
                />
                <p className="mt-1 font-medium text-foreground">
                  {countryLabelWithFlag(payload.destinationCountry)}
                </p>
                {renderInlineEditor("destinationCountry")}
              </div>
              <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
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

            <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
              <SectionHeader
                title="Products"
                accessor="products"
                onEdit={startEdit}
                editing={editingAccessor === "products"}
              />
              {renderInlineEditor("products")}
              {editingAccessor !== "products" && (
              <ul className="mt-2 space-y-2">
                {payload.products.map((product) => (
                  <li key={product.id} className="text-sm text-foreground">
                    <span className="font-medium">
                      {productLabel(product.id, lineItems)}
                    </span>
                    {product.files.length > 0 && (
                      <FileAttachmentList
                        filenames={product.files}
                        fileSizes={fileSizes}
                        className="mt-2"
                      />
                    )}
                  </li>
                ))}
              </ul>
              )}
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
              <SectionHeader
                title="Billing contact"
                accessor="billingDetails"
                onEdit={startEdit}
                editing={editingAccessor === "billingDetails"}
              />
              {renderInlineEditor("billingDetails")}
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {payload.billingDetails.business &&
                payload.billingDetails.businessDetails?.companyName ? (
                  <>
                    {payload.billingDetails.businessDetails.companyName}
                    <br />
                  </>
                ) : null}
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
              <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
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

            <section className="rounded-xl border border-primary/15 bg-primary/5 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
                  <p className="text-sm text-muted-foreground">
                    Loading price from server…
                  </p>
                </div>
              )}
              <div className="mt-4 space-y-1 border-t border-primary/15 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-foreground">
                    Total (excl. VAT)
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    €{centsToEuros(priceDisplay.grossTotalCents).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {priceDisplay.vatNote.replace(
                    /total incl\. VAT equals net/i,
                    "confirmed price is net (excl. VAT)",
                  )}
                </p>
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
              <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Attached documents ({files.length})
                </p>
                <FileAttachmentList
                  filenames={files.map((file) => file.name)}
                  fileSizes={fileSizes}
                  className="mt-2"
                  orientation="row"
                />
              </section>
            )}

            {(consentConfig.showNewsletter || consentConfig.termsRequired) && (
              <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Consent
                </p>
                <div className="mt-3 space-y-3">
                  {consentConfig.showNewsletter && (
                    <div className="flex items-start gap-3">
                      <input
                        id="summary-newsletter"
                        type="checkbox"
                        checked={newsletterOptIn}
                        onChange={(event) =>
                          setNewsletterOptIn(event.target.checked)
                        }
                        disabled={submitting}
                        className="mt-0.5 size-4 shrink-0 rounded border border-input accent-primary"
                      />
                      <Label
                        htmlFor="summary-newsletter"
                        className="cursor-pointer text-sm leading-relaxed text-foreground"
                      >
                        Subscribe to the notarity newsletter
                      </Label>
                    </div>
                  )}
                  {consentConfig.termsRequired && (
                    <div className="flex items-start gap-3">
                      <input
                        id="summary-terms"
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(event) => {
                          setTermsAccepted(event.target.checked);
                          if (event.target.checked) {
                            setConsentError(null);
                          }
                        }}
                        disabled={submitting}
                        className="mt-0.5 size-4 shrink-0 rounded border border-input accent-primary"
                      />
                      <Label
                        htmlFor="summary-terms"
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
                </div>
                {consentError && (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {consentError}
                  </p>
                )}
              </section>
            )}

            {bookError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <p>{bookError}</p>
                {bookErrorDetails && (
                  <details className="mt-2 text-xs text-destructive/90">
                    <summary className="cursor-pointer select-none font-medium">
                      Details
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-destructive/5 p-2 font-mono text-[11px] leading-relaxed">
                      {bookErrorDetails}
                    </pre>
                  </details>
                )}
              </div>
            )}

          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="flex-col gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          type="button"
          size="lg"
          className="tap-press min-h-12 w-full text-base font-semibold shadow-sm"
          onClick={() => void handleBook()}
          disabled={submitting || editingAccessor !== null || consentBlocked}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className="size-5 motion-safe:animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              Submitting your booking…
            </span>
          ) : (
            "Book it"
          )}
        </Button>
        <p className="w-full text-center text-xs text-muted-foreground">
          Debug mode — no real emails · draft{" "}
          <span className="font-mono text-[10px]">
            {payload._appointmentRequestDraft}
          </span>
        </p>
      </CardFooter>
    </Card>
  );
}
