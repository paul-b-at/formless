import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

import { AppointmentRequest } from "./booking-schema";
import type { AppointmentRequest as AppointmentRequestType } from "./booking-schema";
import {
  applyAnswer,
  autoAttachSessionFiles,
  componentLabel,
  findNewlyAttachedFile,
  getCountryOptions,
  getProductsNeedingFiles,
  getTimeslotLabel,
  getVisibleProductPickerTags,
  formatUnmatchedDestinationCountryMessage,
  formatUnsupportedDestinationCountryMessage,
  isDestinationCountrySupported,
  resolveDestinationCountryAnswer,
  resolveDestinationCountryInput,
  isUploadFileName,
  nextUnfilled,
  parseBookingForm,
  productDisplayName,
  resolveFileUploadProductId,
  validateFileForProductUpload,
  type BookingFormSchema,
  type Collected,
  type Component,
  type ProductDefinition,
} from "./form-interpreter";
import {
  isResolvedExtraction,
  resolveToOptionValue,
} from "./answer-resolution";
import {
  getEngineGeminiCallCount,
  recordEngineGeminiCall,
  resetEngineGeminiCallCount,
} from "./gemini-metrics";
import { GEMINI_MODEL } from "./gemini-model";
import { mapDocumentHintToProduct } from "./ocr-product-map";
import { clearDependentsOf } from "./collected-edit";
import {
  getConsentConfig,
  isConsentComponent,
  type ConsentConfig,
} from "./consent-config";
import { validateAnswer } from "./field-validation";
import { sanitizeCollected } from "./party-sanitize";
import {
  buildTimeslotOptions,
  formatTimeslotLabel,
  type LabeledOption,
} from "./timeslot-format";
import {
  getProductsByTags,
  getTimeslots,
  priceRequest,
  sumNetToEuros,
  type PriceLineItem,
} from "./notarity";
import {
  applyParticipantsChatAction,
  defaultParticipantRow,
  getParticipantSetup,
  mergeParticipantRows,
  normalizedRows,
  parseParticipantsChatMessage,
  parseParticipantsStructuredAnswer,
  stripParticipantMeta,
  validateParticipantRows,
  type ParticipantRow,
  type ParticipantSetup,
} from "./participant-config";
import {
  getPreferredNotaryConfig,
  pendingPreferredNotaryComponent,
  PREFERRED_NOTARY_DEFAULT,
  resolvePreferredNotaryValue,
} from "./preferred-notary-config";

const DRAFT_ID = "vfniS9nfoq8nMpRqQj7Z";

const PRICE_CHECK_PARTY = {
  firstName: "Price",
  lastName: "Check",
  business: false,
  email: "price-check@notarity.com",
  phoneNumber: "+4310000000",
};

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "checkbox";
  required?: boolean;
  defaultValue?: string;
};

export type StepOption = LabeledOption;

export type EngineState = {
  form: BookingFormSchema;
  collected: Collected;
  messages: { role: "user" | "assistant"; content: string }[];
  pricing?: { lineItems: PriceLineItem[]; euroTotal: number };
  productCatalog?: ProductDefinition[];
  availableTimeslots?: { id: string; startTime: string }[];
  /** Filenames already uploaded in this chat — reused for product file requirements. */
  sessionFiles?: string[];
  /** Maps each session filename to the product id it belongs to (no cross-product reuse). */
  sessionFileOwners?: Record<string, string>;
};

export type EngineStep =
  | {
      type: "ask";
      accessor: string;
      question: string;
      options?: StepOption[];
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | {
      type: "fileUpload";
      accessor: "products";
      productId: string;
      productLabel: string;
      question: string;
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | {
      type: "form";
      accessor: string;
      title: string;
      fields: FormField[];
      error?: string;
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | {
      type: "participants";
      accessor: "participants";
      title: string;
      minParticipants: number;
      maxParticipants: number;
      participants: ParticipantRow[];
      error?: string;
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | {
      type: "consent";
      accessor: "consent";
      title: string;
      termsRequired: boolean;
      showNewsletter: boolean;
      newsletter?: boolean;
      termsAccepted?: boolean;
      error?: string;
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | { type: "complete"; payload: AppointmentRequestType };

export {
  getEngineGeminiCallCount,
  resetEngineGeminiCallCount,
};

const GeminiExtractSchema = z.object({
  extractedValue: z.string().nullable(),
});

function applyDefaults(form: BookingFormSchema, collected: Collected): Collected {
  const company = form._company ?? "HpKfHmbViXxFEMzjtxln";
  return {
    mode: "debug",
    language: "en",
    timezone: "Europe/Vienna",
    _appointmentRequestDraft: DRAFT_ID,
    _bookingForm: form.id,
    origin: `https://staging.notarity.com/#/my-companies/${company}/appointment-requests`,
    preferredNotary: "",
    instant: false,
    instantNotarisationSupported: false,
    ...collected,
  };
}

function normalizeCollected(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): Collected {
  let next = { ...collected };

  if (
    next.contactDetails?.contactDetailsSameAsBillingDetails &&
    next.billingDetails
  ) {
    next.contactDetails = {
      contactDetailsSameAsBillingDetails: true,
      firstName: next.billingDetails.firstName,
      lastName: next.billingDetails.lastName,
      business: next.billingDetails.business,
      email: next.billingDetails.email,
      phoneNumber: next.billingDetails.phoneNumber,
      ...(next.billingDetails.businessDetails
        ? { businessDetails: next.billingDetails.businessDetails }
        : {}),
    };
  }

  if (
    next.shippingDetails?.shippingDetailsSameAsBillingDetails &&
    next.billingDetails
  ) {
    next.shippingDetails = {
      shippingDetailsSameAsBillingDetails: true,
      firstName: next.billingDetails.firstName,
      lastName: next.billingDetails.lastName,
      business: next.billingDetails.business,
      email: next.billingDetails.email,
      phoneNumber: next.billingDetails.phoneNumber,
      address: next.billingDetails.address,
      zipCode: next.billingDetails.zipCode,
      city: next.billingDetails.city,
      stateProvince: next.billingDetails.stateProvince,
      countryCode: next.billingDetails.countryCode,
    };
  }

  if (next.hardCopy?.hardCopy === false) {
    delete next.shippingDetails;
  }

  delete next.termsAccepted;

  next.preferredNotary = resolvePreferredNotaryValue(form, next, catalog);

  return stripParticipantMeta(next);
}

function selectionChanged(before: Collected, after: Collected): boolean {
  return (
    JSON.stringify(before.products) !== JSON.stringify(after.products) ||
    JSON.stringify(before.timeslots) !== JSON.stringify(after.timeslots) ||
    JSON.stringify(before.hardCopy) !== JSON.stringify(after.hardCopy) ||
    JSON.stringify(before.participants) !== JSON.stringify(after.participants) ||
    before.destinationCountry !== after.destinationCountry
  );
}

function collectSingleProductDefs(form: BookingFormSchema): ProductDefinition[] {
  const defs: ProductDefinition[] = [];

  function walk(components: Component[]): void {
    for (const component of components) {
      if (component.type === "condition") {
        walk(component.props?.components ?? []);
        walk(component.props?.elseComponents ?? []);
      }
      if (component.type === "singleProduct" && component.props?._product) {
        const productId = component.props._product;
        defs.push({
          id: productId,
          title: {
            en:
              productId === "xK5IkgPX1LTYdWLFzW8X"
                ? "NIE Personal Data"
                : "Auto-added product",
          },
          fileUploadRequired: true,
        });
      }
    }
  }

  for (const page of form.pages) {
    walk(page.components);
  }
  return defs;
}

async function loadProductCatalog(
  form: BookingFormSchema,
  collected: Collected,
): Promise<ProductDefinition[]> {
  const tags = getVisibleProductPickerTags(form, collected);
  const autoAdded = collectSingleProductDefs(form);
  if (tags.length === 0) {
    return autoAdded;
  }
  const products = await getProductsByTags(tags);
  const fromTags = products.map((p) => ({
    id: String(p.id),
    title: (p.title as Record<string, string>) ?? {},
    apostilleRequired: Boolean(p.apostilleRequired),
    showApostille: Boolean(p.showApostille),
    fileUploadRequired: Boolean(p.fileUploadRequired),
    showFileUpload: Boolean(p.showFileUpload),
  }));
  const byId = new Map<string, ProductDefinition>();
  for (const p of [...fromTags, ...autoAdded]) {
    byId.set(p.id, p);
  }
  return [...byId.values()];
}

async function loadTimeslots(
  form: BookingFormSchema,
  collected: Collected,
): Promise<{ id: string; startTime: string }[]> {
  const label = getTimeslotLabel(form, collected);
  if (!label) {
    return [];
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const slots = await getTimeslots({
    timeslotLabel: label,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  return slots
    .filter((s) => s.available > 0)
    .map((s) => ({ id: s.id, startTime: s.startTime }));
}

function deriveParticipants(collected: Collected): Collected {
  if (collected.participants?.length) {
    return collected;
  }
  const email = collected.billingDetails?.email;
  if (!email) {
    return collected;
  }
  return {
    ...collected,
    participants: [{ email, client: true, supervisor: false }],
  };
}

function buildPricingPayload(
  form: BookingFormSchema,
  collected: Collected,
  euroTotal: number,
): AppointmentRequestType {
  const base = deriveParticipants(applyDefaults(form, collected));
  const hardCopy = base.hardCopy ?? { hardCopy: false, expressShipping: false };
  const billing = base.billingDetails ?? PRICE_CHECK_PARTY;

  return AppointmentRequest.parse({
    ...base,
    confirmedPrice: euroTotal,
    participants: base.participants ?? [
      { email: "price-check@notarity.com", client: true, supervisor: false },
    ],
    timeslots: base.timeslots?.length
      ? base.timeslots
      : ["price-check-placeholder"],
    billingDetails: billing,
    contactDetails: base.contactDetails ?? {
      contactDetailsSameAsBillingDetails: true,
    },
    hardCopy,
    shippingDetails: hardCopy.hardCopy
      ? (base.shippingDetails ?? {
          shippingDetailsSameAsBillingDetails: true,
          ...PRICE_CHECK_PARTY,
        })
      : undefined,
  });
}

let loggedPriceResponse = false;

async function refreshPricing(
  form: BookingFormSchema,
  collected: Collected,
): Promise<{ lineItems: PriceLineItem[]; euroTotal: number } | undefined> {
  try {
    const draft = AppointmentRequest.partial().parse(collected);
    if (!draft.products?.length || !draft.destinationCountry) {
      return undefined;
    }
    const payload = buildPricingPayload(
      form,
      collected,
      collected.confirmedPrice ?? 0,
    );
    const lineItems = await priceRequest(payload);
    if (!loggedPriceResponse) {
      console.log(
        "[price] Full /price response:",
        JSON.stringify(lineItems, null, 2),
      );
      loggedPriceResponse = true;
    }
    return { lineItems, euroTotal: sumNetToEuros(lineItems) };
  } catch {
    return undefined;
  }
}

function findComponentByAccessor(
  form: BookingFormSchema,
  accessor: string,
): Component | null {
  function walk(components: Component[]): Component | null {
    for (const component of components) {
      if (component.type === "condition") {
        const inThen = walk(component.props?.components ?? []);
        if (inThen) {
          return inThen;
        }
        const inElse = walk(component.props?.elseComponents ?? []);
        if (inElse) {
          return inElse;
        }
        continue;
      }

      const componentAccessor =
        component.accessor ??
        (component.type === "timeSlots"
          ? "timeslots"
          : component.type === "countryPicker"
            ? "destinationCountry"
            : component.type === "productPicker"
              ? "products"
              : null);

      if (componentAccessor === accessor) {
        return component;
      }
    }
    return null;
  }

  for (const page of form.pages) {
    const found = walk(page.components);
    if (found) {
      return found;
    }
  }
  return null;
}

function matchProductId(
  message: string,
  catalog: ProductDefinition[],
): string | null {
  if (/\.pdf$/i.test(message.trim())) {
    return null;
  }
  const lower = message.toLowerCase();
  for (const product of catalog) {
    const title = product.title.en?.toLowerCase() ?? "";
    if (lower.includes(title) || lower.includes(product.id.toLowerCase())) {
      return product.id;
    }
    if (
      title.includes("nie") &&
      lower.includes("nie") &&
      lower.includes("application")
    ) {
      return product.id;
    }
  }
  if (lower.includes("nie") && lower.includes("application")) {
    return catalog.find((p) => p.id === "UpEJ7raQEKQKFhWn12r2")?.id ?? null;
  }
  return null;
}

function fallbackExtract(
  component: Component,
  message: string,
  form: BookingFormSchema,
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  collected: Collected,
): unknown {
  const accessor = component.accessor ?? component.type;
  const trimmed = message.trim();

  switch (accessor) {
    case "destinationCountry":
      return resolveDestinationCountryInput(trimmed, form) ?? trimmed;
    case "products": {
      const fileMatch = trimmed.match(/[\w.-]+\.(pdf|png|jpe?g|webp)/i);
      if (fileMatch) {
        const fileName = fileMatch[0];
        const productId = resolveFileUploadProductId(
          fileName,
          collected,
          catalog,
        );
        if (productId) {
          const existing = (collected.products ?? []).find(
            (product) => product.id === productId,
          );
          if (existing) {
            const def = catalog.find((entry) => entry.id === productId);
            return {
              ...existing,
              files: [...new Set([...existing.files, fileName])],
              apostille: def?.apostilleRequired ? true : existing.apostille,
            };
          }
        }
      }
      const productId = matchProductId(trimmed, catalog);
      if (productId) {
        const def = catalog.find((p) => p.id === productId);
        return {
          id: productId,
          apostille: def?.apostilleRequired ? true : null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        };
      }
      return trimmed;
    }
    case "timeslots": {
      if (availableTimeslots.some((s) => s.id === trimmed)) {
        return [trimmed];
      }
      if (/first|earliest|available/i.test(trimmed) && availableTimeslots[0]) {
        return [availableTimeslots[0].id];
      }
      return [trimmed];
    }
    case "hardCopy": {
      const lower = trimmed.toLowerCase();
      if (/express shipping only/i.test(lower)) {
        return { hardCopy: false, expressShipping: true };
      }
      if (
        lower === "no hard copy needed" ||
        /^(no|without)\b/.test(lower) ||
        /\bnot needed\b/.test(lower)
      ) {
        return { hardCopy: false, expressShipping: false };
      }
      if (/yes|send a hard copy|true/i.test(trimmed)) {
        return { hardCopy: true, expressShipping: false };
      }
      return { hardCopy: false, expressShipping: false };
    }
    case "contactDetails": {
      if (/same|yes/i.test(trimmed)) {
        const billing = collected.billingDetails;
        return {
          contactDetailsSameAsBillingDetails: true,
          firstName: billing?.firstName,
          lastName: billing?.lastName,
          business: billing?.business ?? false,
          email: billing?.email,
          phoneNumber: billing?.phoneNumber,
          ...(billing?.businessDetails
            ? { businessDetails: billing.businessDetails }
            : {}),
        };
      }
      if (/different|separate|enter/i.test(trimmed)) {
        return { contactDetailsSameAsBillingDetails: false };
      }
      return trimmed;
    }
    case "shippingDetails": {
      if (/same as billing/i.test(trimmed)) {
        const billing = collected.billingDetails;
        return {
          shippingDetailsSameAsBillingDetails: true,
          firstName: billing?.firstName,
          lastName: billing?.lastName,
          business: billing?.business ?? false,
          email: billing?.email,
          phoneNumber: billing?.phoneNumber,
          address: billing?.address,
          zipCode: billing?.zipCode,
          city: billing?.city,
          stateProvince: billing?.stateProvince,
          countryCode: billing?.countryCode,
        };
      }
      if (/different/i.test(trimmed)) {
        return { shippingDetailsSameAsBillingDetails: false };
      }
      return trimmed;
    }
    case "participants":
      return [{ email: trimmed, client: true, supervisor: false }];
    default:
      return trimmed;
  }
}

async function extractWithGeminiOnce(
  component: Component,
  message: string,
  form: BookingFormSchema,
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  collected: Collected,
  options: StepOption[] | undefined,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbackExtract(
      component,
      message,
      form,
      catalog,
      availableTimeslots,
      collected,
    );
  }

  recordEngineGeminiCall();

  const ai = new GoogleGenAI({ apiKey });
  const accessor = component.accessor ?? component.type;
  const optionsList =
    options
      ?.map((option) => `- value: "${option.value}" | label: "${option.label}"`)
      .join("\n") ?? "none";
  const catalogSummary = catalog
    .map((product) => `${product.id}: ${product.title.en ?? product.id}`)
    .join(", ");
  const slotSummary = availableTimeslots
    .slice(0, 8)
    .map((slot) => slot.id)
    .join(", ");

  const prompt = `Parse the user's typed answer for booking form field "${accessor}" (type: ${component.type}).
User message: "${message}"

Allowed options — return the exact "value" string if one fits:
${optionsList}

Catalog products: ${catalogSummary || "none"}
Timeslot ids: ${slotSummary || "none"}

Return JSON: { "extractedValue": "<exact option value, ISO country code, product title, timeslot id, pdf filename, email, or null>" }`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedValue: { type: Type.STRING, nullable: true },
          },
          required: ["extractedValue"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      return fallbackExtract(
        component,
        message,
        form,
        catalog,
        availableTimeslots,
        collected,
      );
    }

    const parsed = GeminiExtractSchema.safeParse(JSON.parse(text));
    if (!parsed.success || !parsed.data.extractedValue) {
      return fallbackExtract(
        component,
        message,
        form,
        catalog,
        availableTimeslots,
        collected,
      );
    }

    return fallbackExtract(
      component,
      parsed.data.extractedValue,
      form,
      catalog,
      availableTimeslots,
      collected,
    );
  } catch {
    return fallbackExtract(
      component,
      message,
      form,
      catalog,
      availableTimeslots,
      collected,
    );
  }
}

/** Deterministic first; at most one Gemini call for ambiguous typed free text. */
async function extractUserAnswer(
  component: Component,
  message: string,
  form: BookingFormSchema,
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  rawCollected: Collected,
  collected: Collected,
): Promise<unknown> {
  const options = getOptionsForComponent(
    component,
    form,
    catalog,
    availableTimeslots,
    rawCollected,
    collected,
  );

  let normalizedMessage = message.trim();

  if (options?.length) {
    const optionValue = resolveToOptionValue(normalizedMessage, options);
    if (optionValue) {
      normalizedMessage = optionValue;
    }
  }

  const accessor = component.accessor ?? component.type;
  if (accessor === "products" && options?.length) {
    const mapped = await mapDocumentHintToProduct({
      productHint: normalizedMessage,
      catalog,
    });
    if (
      mapped.productTitle &&
      options.some((option) => option.value === mapped.productTitle)
    ) {
      normalizedMessage = mapped.productTitle;
    }
  }

  const deterministic = fallbackExtract(
    component,
    normalizedMessage,
    form,
    catalog,
    availableTimeslots,
    collected,
  );

  if (accessor === "products") {
    if (
      typeof deterministic === "object" &&
      deterministic !== null &&
      "id" in deterministic &&
      typeof (deterministic as { id: string }).id === "string"
    ) {
      return deterministic;
    }
    if (typeof deterministic === "string" && isUploadFileName(deterministic)) {
      return deterministic;
    }
  }

  if (
    isResolvedExtraction(
      component,
      normalizedMessage,
      deterministic,
      catalog,
      availableTimeslots,
    )
  ) {
    return deterministic;
  }

  return extractWithGeminiOnce(
    component,
    message,
    form,
    catalog,
    availableTimeslots,
    collected,
    options,
  );
}

function enrichProductFiles(
  collected: Collected,
  component: Component,
  value: unknown,
): unknown {
  if (component.accessor !== "products") {
    return value;
  }
  if (typeof value === "object" && value !== null && "files" in value) {
    const update = value as { id: string; files: string[] };
    if (update.files.length > 0) {
      return update;
    }
  }
  return value;
}

export const PARTY_FORM_FIELDS: FormField[] = [
  { name: "firstName", label: "First name", type: "text", required: true },
  { name: "lastName", label: "Last name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phoneNumber", label: "Phone", type: "tel", required: true },
  { name: "address", label: "Address", type: "text" },
  { name: "zipCode", label: "ZIP / Postal code", type: "text" },
  { name: "city", label: "City", type: "text" },
  { name: "stateProvince", label: "State / Province", type: "text" },
  { name: "countryCode", label: "Country code (ISO-2)", type: "text" },
];

const BUSINESS_BILLING_HINT =
  /flexco|gmbh|incorporat|company formation|gesellschaft|gründung/i;

function schemaSupportsBusinessBilling(component: Component): boolean {
  const props = component.props;
  if (!props) {
    return false;
  }
  return (
    props.business === true ||
    props.businessRequired === true ||
    props.showBusiness === true
  );
}

function inferBusinessBillingDefault(
  collected: Collected,
  catalog: ProductDefinition[],
): boolean {
  if (collected.billingDetails?.business === true) {
    return true;
  }
  for (const selection of collected.products ?? []) {
    const def = catalog.find((entry) => entry.id === selection.id);
    const text = [def?.title?.en, def?.description?.en]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    if (BUSINESS_BILLING_HINT.test(text)) {
      return true;
    }
  }
  return false;
}

export function buildPartyFormFields(
  component: Component,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): FormField[] {
  const accessor = component.accessor ?? component.type;
  if (accessor !== "billingDetails") {
    return PARTY_FORM_FIELDS;
  }

  const businessDefault = inferBusinessBillingDefault(collected, catalog);
  const includeBusiness =
    schemaSupportsBusinessBilling(component) || accessor === "billingDetails";

  if (!includeBusiness) {
    return PARTY_FORM_FIELDS;
  }

  return [
    {
      name: "business",
      label: "Business / company billing",
      type: "checkbox",
      defaultValue: businessDefault ? "true" : "false",
    },
    ...PARTY_FORM_FIELDS,
    {
      name: "companyName",
      label: "Company name",
      type: "text",
      required: true,
    },
    { name: "vat", label: "VAT number (optional)", type: "text" },
  ];
}

export function getPartyFormFieldsForAccessor(
  form: BookingFormSchema,
  accessor: string,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): FormField[] {
  const component = findComponentByAccessor(form, accessor);
  if (!component) {
    return PARTY_FORM_FIELDS;
  }
  return buildPartyFormFields(component, collected, catalog);
}

export function parsePartyStructuredAnswer(
  structuredAnswer: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...structuredAnswer };
  const business =
    next.business === true ||
    next.business === "true" ||
    (typeof next.business === "string" &&
      next.business.trim().toLowerCase() === "true");

  next.business = business;

  if (business) {
    const existing = next.businessDetails as
      | { companyName?: string; vat?: string }
      | undefined;
    const companyName = String(
      next.companyName ?? existing?.companyName ?? "",
    ).trim();
    const vat = String(next.vat ?? existing?.vat ?? "").trim();
    next.businessDetails = { companyName, vat };
    delete next.companyName;
    delete next.vat;
  } else {
    delete next.businessDetails;
    delete next.companyName;
    delete next.vat;
  }

  return next;
}

function shouldEmitFormStep(
  component: Component,
  collected: Collected,
): boolean {
  const accessor = component.accessor ?? component.type;
  if (accessor === "billingDetails") {
    return true;
  }
  if (accessor === "contactDetails") {
    return collected.contactDetails?.contactDetailsSameAsBillingDetails === false;
  }
  if (accessor === "shippingDetails") {
    return collected.shippingDetails?.shippingDetailsSameAsBillingDetails === false;
  }
  return false;
}

function shouldEmitParticipantsStep(component: Component): boolean {
  const accessor = component.accessor ?? component.type;
  return accessor === "participants";
}

function shouldEmitConsentStep(component: Component): boolean {
  return isConsentComponent(component);
}

function buildPreferredNotaryStep(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[],
  pricing?: PricingSlice,
): Extract<EngineStep, { type: "ask" }> {
  const config = getPreferredNotaryConfig(form, collected, catalog);
  const options: StepOption[] = [];
  if (!config.required) {
    options.push(asOption("No preference", PREFERRED_NOTARY_DEFAULT));
  }
  for (const option of config.options) {
    options.push(asOption(option.label, option.id));
  }

  return {
    type: "ask",
    accessor: "preferredNotary",
    question: "Would you like to request a specific notary?",
    options,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function buildConsentStep(
  form: BookingFormSchema,
  collected: Collected,
  pricing?: PricingSlice,
): Extract<EngineStep, { type: "consent" }> {
  const config = getConsentConfig(form, collected);
  return {
    type: "consent",
    accessor: "consent",
    title: "Almost done — confirm the details below",
    termsRequired: config.termsRequired,
    showNewsletter: config.showNewsletter,
    newsletter: collected.newsletter,
    termsAccepted: collected.termsAccepted,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

type ConsentStructuredAnswer = {
  newsletter?: boolean;
  termsAccepted?: boolean;
};

function parseConsentStructuredAnswer(
  value: Record<string, unknown>,
): ConsentStructuredAnswer {
  const answer: ConsentStructuredAnswer = {};
  if ("newsletter" in value) {
    answer.newsletter = Boolean(value.newsletter);
  }
  if ("termsAccepted" in value) {
    answer.termsAccepted = Boolean(value.termsAccepted);
  }
  return answer;
}

function validateConsentAnswer(
  config: ConsentConfig,
  answer: ConsentStructuredAnswer,
  collected: Collected,
): { ok: true } | { ok: false; message: string } {
  const termsAccepted =
    answer.termsAccepted ?? collected.termsAccepted ?? false;
  if (config.termsRequired && !termsAccepted) {
    return {
      ok: false,
      message: "Please accept the terms and conditions to continue.",
    };
  }
  if (config.showNewsletter && answer.newsletter === undefined) {
    const hasNewsletter = collected.newsletter !== undefined;
    if (!hasNewsletter) {
      return {
        ok: false,
        message: "Please choose whether you want the newsletter.",
      };
    }
  }
  return { ok: true };
}

function applyConsentAnswer(
  form: BookingFormSchema,
  collected: Collected,
  answer: ConsentStructuredAnswer,
  config: ConsentConfig,
  catalog: ProductDefinition[] = [],
): Collected {
  let next: Collected = { ...collected };

  if (config.showNewsletter && answer.newsletter !== undefined) {
    const newsletterComponent = config.newsletterComponent;
    if (newsletterComponent) {
      next = applyAnswer(
        form,
        next,
        newsletterComponent,
        answer.newsletter,
        catalog,
      );
    } else {
      next.newsletter = answer.newsletter;
    }
  }

  if (config.termsRequired && answer.termsAccepted !== undefined) {
    const termsComponent = config.termsComponent;
    if (termsComponent) {
      next = applyAnswer(
        form,
        next,
        termsComponent,
        answer.termsAccepted,
        catalog,
      );
    } else {
      next.termsAccepted = answer.termsAccepted;
    }
  } else if (!config.termsRequired) {
    next.termsAccepted = true;
  }

  return next;
}

function parseConsentTextAnswer(
  message: string,
  collected: Collected,
  config: ConsentConfig,
): ConsentStructuredAnswer | null {
  const lower = message.trim().toLowerCase();
  const affirmative = [
    "yes",
    "accept",
    "i accept",
    "agree",
    "i agree",
    "ok",
    "okay",
  ];
  if (!affirmative.some((token) => lower.includes(token))) {
    return null;
  }
  return {
    termsAccepted: true,
    newsletter: collected.newsletter ?? false,
  };
}

export function buildParticipantsStep(
  component: Component,
  collected: Collected,
  setup: ParticipantSetup,
  pricing?: { lineItems: PriceLineItem[]; euroTotal: number },
  error?: string,
): Extract<EngineStep, { type: "participants" }> {
  return {
    type: "participants",
    accessor: "participants",
    title: setup.title,
    minParticipants: setup.minParticipants,
    maxParticipants: setup.maxParticipants,
    participants: normalizedRows(collected.participants),
    error,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function buildFormStep(
  component: Component,
  collected: Collected,
  catalog: ProductDefinition[],
  pricing?: { lineItems: PriceLineItem[]; euroTotal: number },
): Extract<EngineStep, { type: "form" }> {
  const accessor = component.accessor ?? component.type;
  const title =
    accessor === "billingDetails"
      ? "Billing details"
      : accessor === "contactDetails"
        ? "Contact details"
        : "Shipping address";

  return {
    type: "form",
    accessor,
    title,
    fields: buildPartyFormFields(component, collected, catalog),
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function asOption(label: string, value?: string): StepOption {
  return { label, value: value ?? label };
}

function getOptionsForComponent(
  component: Component,
  form: BookingFormSchema,
  catalog: ProductDefinition[],
  slots: { id: string; startTime: string }[],
  rawCollected: Collected,
  collected: Collected,
): StepOption[] | undefined {
  switch (component.type) {
    case "countryPicker":
      return getCountryOptions(form).map((c) =>
        asOption(`${c.label} (${c.code})`, c.code),
      );
    case "productPicker": {
      const needingFiles = (collected.products ?? []).filter((p) => {
        const def = catalog.find((d) => d.id === p.id);
        return def?.fileUploadRequired && p.files.length === 0;
      });
      if (needingFiles.length > 0) {
        return undefined;
      }
      return catalog
        .filter((p) => p.title.en !== "Auto-added product")
        .map((p) => asOption(p.title.en ?? p.id));
    }
    case "timeSlots":
      return buildTimeslotOptions(slots);
    case "hardCopy":
      return [
        asOption("Yes, send a hard copy"),
        asOption("No hard copy needed"),
        asOption("Express shipping only, no hard copy"),
      ];
    default:
      break;
  }

  const accessor = component.accessor ?? component.type;
  if (accessor === "contactDetails" && rawCollected.contactDetails === undefined) {
    return [
      asOption("Same as billing"),
      asOption("Enter different contact details"),
    ];
  }
  if (accessor === "shippingDetails" && rawCollected.shippingDetails === undefined) {
    return [
      asOption("Same as billing address"),
      asOption("Different shipping address"),
    ];
  }

  return undefined;
}

type PricingSlice = {
  lineItems: PriceLineItem[];
  euroTotal: number;
};

function isExplicitFileUploadAnswer(
  userMessage: string,
  uploadKind?: "file",
  uploadProductId?: string,
): boolean {
  return (
    uploadKind === "file" &&
    Boolean(uploadProductId) &&
    isUploadFileName(userMessage)
  );
}

function isReplayFileUploadAnswer(
  userMessage: string,
  current: Component | null,
  uploadKind?: "file",
  uploadProductId?: string,
): boolean {
  if (uploadKind === "file" || uploadProductId) {
    return false;
  }
  if (!current) {
    return false;
  }
  const accessor = current.accessor ?? current.type;
  return accessor === "products" && isUploadFileName(userMessage);
}

function fileUploadStepForProduct(
  productId: string,
  catalog: ProductDefinition[],
  pricing?: PricingSlice,
): Extract<EngineStep, { type: "fileUpload" }> {
  const def = catalog.find((entry) => entry.id === productId);
  const name = productDisplayName(def, productId);
  return {
    type: "fileUpload",
    accessor: "products",
    productId,
    productLabel: name,
    question: `Attach the document for ${name}.`,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function tryBuildFileUploadStep(
  component: Component,
  collected: Collected,
  catalog: ProductDefinition[],
  pricing?: PricingSlice,
): Extract<EngineStep, { type: "fileUpload" }> | null {
  const accessor = component.accessor ?? component.type;
  if (accessor !== "products") {
    return null;
  }

  const needingFiles = getProductsNeedingFiles(collected, catalog);
  if (needingFiles.length === 0) {
    return null;
  }

  const target = needingFiles[0]!;
  const def = catalog.find((entry) => entry.id === target.id);
  const name = productDisplayName(def, target.id);

  return {
    type: "fileUpload",
    accessor: "products",
    productId: target.id,
    productLabel: name,
    question: `Attach the document for ${name}.`,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function buildStepFromComponent(
  component: Component,
  form: BookingFormSchema,
  rawCollected: Collected,
  collected: Collected,
  catalog: ProductDefinition[],
  slots: { id: string; startTime: string }[],
  pricing?: PricingSlice,
): EngineStep {
  const fileUpload = tryBuildFileUploadStep(component, collected, catalog, pricing);
  if (fileUpload) {
    return fileUpload;
  }

  if (shouldEmitParticipantsStep(component)) {
    return buildParticipantsStep(
      component,
      collected,
      getParticipantSetup(component),
      pricing,
    );
  }

  if (shouldEmitConsentStep(component)) {
    return buildConsentStep(form, collected, pricing);
  }

  const question = formatQuestion(component, catalog, slots, collected);
  const options = getOptionsForComponent(
    component,
    form,
    catalog,
    slots,
    rawCollected,
    collected,
  );

  return {
    type: "ask",
    accessor: component.accessor ?? component.type,
    question,
    options,
    lineItems: pricing?.lineItems,
    euroTotal: pricing?.euroTotal,
  };
}

function formatQuestion(
  component: Component,
  catalog: ProductDefinition[],
  slots: { id: string; startTime: string }[],
  collected: Collected,
): string {
  const label = componentLabel(component);
  switch (component.accessor ?? component.type) {
    case "destinationCountry":
      return "Which country is the destination for your notarisation?";
    case "products": {
      const needingFiles = getProductsNeedingFiles(collected, catalog);
      if (needingFiles.length > 0) {
        const target = needingFiles[0]!;
        const def = catalog.find((entry) => entry.id === target.id);
        const name = productDisplayName(def, target.id);
        return `Attach the document for ${name}.`;
      }
      if (catalog.length > 0) {
        const names = catalog
          .filter((p) => p.title.en !== "Auto-added product")
          .map((p) => p.title.en ?? p.id)
          .join(", ");
        return `Which product do you need? Options: ${names}`;
      }
      return "Which product or document do you need notarised?";
    }
    case "timeslots":
      if (slots.length > 0) {
        return `Please choose an appointment time. Available slots include: ${slots
          .slice(0, 3)
          .map((s) => formatTimeslotLabel(s.startTime))
          .join(", ")}`;
      }
      return "When would you like your appointment?";
    case "contactDetails":
      return "Should we use the same contact details as billing?";
    case "hardCopy":
      return "Would you like a hard copy shipped to you?";
    case "shippingDetails":
      if (!collected.shippingDetails) {
        return "Where should we ship the hard copy?";
      }
      return "Please provide your shipping address.";
    case "participants":
      return "Who will participate in the appointment? Add each signer’s email, then continue when ready.";
    case "preferredNotary":
      return "Would you like to request a specific notary?";
    default:
      return `Please provide: ${label}`;
  }
}

function rejectValidation(
  state: EngineState,
  form: BookingFormSchema,
  collected: Collected,
  current: Component,
  userMessage: string,
  structuredAnswer: Record<string, unknown> | undefined,
  errorMessage: string,
  productCatalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  fileUploadProductId?: string,
): { state: EngineState; step: EngineStep } {
  const newState: EngineState = {
    form,
    collected,
    messages: [
      ...state.messages,
      ...(userMessage.trim() || structuredAnswer
        ? [
            {
              role: "user" as const,
              content: structuredAnswer ? "Submitted details" : userMessage,
            },
          ]
        : []),
      { role: "assistant", content: errorMessage },
    ],
    pricing: state.pricing,
    productCatalog,
    availableTimeslots,
    sessionFiles: state.sessionFiles,
    sessionFileOwners: state.sessionFileOwners,
  };

  if (fileUploadProductId) {
    const step = fileUploadStepForProduct(
      fileUploadProductId,
      productCatalog,
      state.pricing,
    );
    return {
      state: newState,
      step: { ...step, question: errorMessage },
    };
  }

  if (shouldEmitFormStep(current, collected)) {
    const formStep = buildFormStep(
      current,
      collected,
      productCatalog,
      state.pricing,
    );
    return {
      state: newState,
      step: { ...formStep, error: errorMessage },
    };
  }

  if (shouldEmitParticipantsStep(current)) {
    const participantsStep = buildParticipantsStep(
      current,
      collected,
      getParticipantSetup(current),
      state.pricing,
      errorMessage,
    );
    return {
      state: newState,
      step: participantsStep,
    };
  }

  if (shouldEmitConsentStep(current)) {
    return {
      state: newState,
      step: { ...buildConsentStep(form, collected, state.pricing), error: errorMessage },
    };
  }

  const step = buildStepFromComponent(
    current,
    form,
    state.collected,
    collected,
    productCatalog,
    availableTimeslots,
    state.pricing,
  );

  let errorStep: EngineStep = step;
  if (step.type === "ask" || step.type === "fileUpload") {
    errorStep = { ...step, question: errorMessage };
  }

  return {
    state: newState,
    step: errorStep,
  };
}

function withSessionFileOwner(
  owners: Record<string, string> | undefined,
  fileName: string,
  productId: string,
): Record<string, string> {
  const normalized = fileName.trim();
  if (!normalized || !productId) {
    return owners ?? {};
  }
  return { ...(owners ?? {}), [normalized]: productId };
}

function productIdForAttachedFile(
  collected: Collected,
  fileName: string,
): string | undefined {
  const normalized = fileName.trim();
  return (collected.products ?? []).find((product) =>
    product.files.includes(normalized),
  )?.id;
}

function applyCollectedUpdates(
  form: BookingFormSchema,
  collected: Collected,
  productCatalog: ProductDefinition[],
  sessionFiles: string[],
  sessionFileOwners: Record<string, string> = {},
): Collected {
  return autoAttachSessionFiles(
    form,
    collected,
    productCatalog,
    sessionFiles,
    sessionFileOwners,
  );
}

export async function advance(
  state: EngineState,
  userMessage: string,
  structuredAnswer?: Record<string, unknown>,
  uploadProductId?: string,
  uploadKind?: "file",
): Promise<{ state: EngineState; step: EngineStep }> {
  const form =
    typeof state.form.id === "string"
      ? state.form
      : parseBookingForm(state.form);

  let collected = applyDefaults(form, state.collected);
  let pricing = state.pricing;
  const sessionFiles = state.sessionFiles ?? [];
  let sessionFileOwners = { ...(state.sessionFileOwners ?? {}) };

  let productCatalog = await loadProductCatalog(form, collected);
  let availableTimeslots = await loadTimeslots(form, collected);

  collected = applyCollectedUpdates(
    form,
    collected,
    productCatalog,
    sessionFiles,
    sessionFileOwners,
  );

  const current =
    pendingPreferredNotaryComponent(form, collected, productCatalog) ??
    nextUnfilled(form, collected, productCatalog);
  let attachedFile: string | undefined;

  if (structuredAnswer && current) {
    const accessor = current.accessor ?? current.type;

    if (isConsentComponent(current)) {
      const config = getConsentConfig(form, collected);
      const parsed = parseConsentStructuredAnswer(structuredAnswer);
      const validation = validateConsentAnswer(config, parsed, collected);
      if (!validation.ok) {
        return rejectValidation(
          state,
          form,
          collected,
          current,
          userMessage,
          structuredAnswer,
          validation.message,
          productCatalog,
          availableTimeslots,
        );
      }
      const before = { ...collected };
      collected = applyConsentAnswer(
        form,
        collected,
        parsed,
        config,
        productCatalog,
      );
      if (selectionChanged(before, collected)) {
        const refreshed = await refreshPricing(form, collected);
        if (refreshed) {
          collected = { ...collected, confirmedPrice: refreshed.euroTotal };
          pricing = refreshed;
        }
      }
    } else if (accessor === "participants") {
      const setup = getParticipantSetup(current);
      const parsed = parseParticipantsStructuredAnswer(
        structuredAnswer,
        normalizedRows(collected.participants),
        setup,
      );
      const validation = validateParticipantRows(parsed.rows, setup);
      if (!validation.ok) {
        return rejectValidation(
          state,
          form,
          collected,
          current,
          userMessage,
          structuredAnswer,
          validation.message,
          productCatalog,
          availableTimeslots,
        );
      }
      const before = { ...collected };
      collected = {
        ...collected,
        participants: parsed.rows,
        participantsExpectMore: parsed.expectMore,
        participantsFinalized: parsed.finalized,
      };
      if (selectionChanged(before, collected)) {
        const refreshed = await refreshPricing(form, collected);
        if (refreshed) {
          collected = { ...collected, confirmedPrice: refreshed.euroTotal };
          pricing = refreshed;
        }
      }
    } else {
    const parsed = parsePartyStructuredAnswer(structuredAnswer);
    let value: unknown = { ...parsed, business: parsed.business ?? false };
    if (accessor === "shippingDetails") {
      value = {
        shippingDetailsSameAsBillingDetails: false,
        ...parsed,
        business: parsed.business ?? false,
      };
    }
    const validation = validateAnswer(current, value);
    if (!validation.ok) {
      return rejectValidation(
        state,
        form,
        collected,
        current,
        userMessage,
        structuredAnswer,
        validation.message,
        productCatalog,
        availableTimeslots,
      );
    }
    const before = { ...collected };
    collected = applyAnswer(form, collected, current, value, productCatalog);
    collected = deriveParticipants(collected);
    attachedFile = findNewlyAttachedFile(before, collected);
    if (attachedFile) {
      const ownerId = productIdForAttachedFile(collected, attachedFile);
      if (ownerId) {
        sessionFileOwners = withSessionFileOwner(
          sessionFileOwners,
          attachedFile,
          ownerId,
        );
      }
    }
    collected = applyCollectedUpdates(
      form,
      collected,
      productCatalog,
      sessionFiles,
      sessionFileOwners,
    );
    if (!attachedFile) {
      attachedFile = findNewlyAttachedFile(before, collected);
    }
    productCatalog = await loadProductCatalog(form, collected);
    availableTimeslots = await loadTimeslots(form, collected);

    if (selectionChanged(before, collected)) {
      const refreshed = await refreshPricing(form, collected);
      if (refreshed) {
        collected = { ...collected, confirmedPrice: refreshed.euroTotal };
        pricing = refreshed;
      }
    }
    }
  } else if (userMessage.trim()) {
    const fileName = userMessage.trim();
    const productsComponent = findComponentByAccessor(form, "products");
    const explicitFile = isExplicitFileUploadAnswer(
      fileName,
      uploadKind,
      uploadProductId,
    );
    const replayFile =
      !explicitFile &&
      isReplayFileUploadAnswer(
        fileName,
        current ?? null,
        uploadKind,
        uploadProductId,
      );

    if (explicitFile || replayFile) {
      const targetId =
        uploadProductId ??
        resolveFileUploadProductId(
          fileName,
          collected,
          productCatalog,
        );

      const rejectFile = (message: string) =>
        rejectValidation(
          state,
          form,
          collected,
          productsComponent ?? current!,
          userMessage,
          undefined,
          message,
          productCatalog,
          availableTimeslots,
          targetId ?? uploadProductId,
        );

      if (!targetId) {
        const needing = getProductsNeedingFiles(collected, productCatalog);
        const label = needing[0]
          ? productDisplayName(
              productCatalog.find((entry) => entry.id === needing[0]!.id),
              needing[0]!.id,
            )
          : "this product";
        return rejectValidation(
          state,
          form,
          collected,
          productsComponent ?? current!,
          userMessage,
          undefined,
          `Please upload a document for ${label}.`,
          productCatalog,
          availableTimeslots,
          needing[0]?.id,
        );
      }

      if (!productsComponent) {
        return rejectFile("Unable to attach this file to a product right now.");
      }

      const fileCheck = validateFileForProductUpload({
        fileName,
        targetProductId: targetId,
        collected,
        catalog: productCatalog,
        sessionFileOwners,
      });
      if (!fileCheck.ok) {
        return rejectFile(fileCheck.message);
      }

      sessionFileOwners = withSessionFileOwner(
        sessionFileOwners,
        fileName,
        targetId,
      );

      const before = { ...collected };
      collected = applyAnswer(
        form,
        collected,
        productsComponent,
        fileName,
        productCatalog,
        targetId,
      );
      collected = deriveParticipants(collected);
      attachedFile = findNewlyAttachedFile(before, collected);
      collected = applyCollectedUpdates(
        form,
        collected,
        productCatalog,
        sessionFiles,
        sessionFileOwners,
      );
      if (!attachedFile) {
        attachedFile = findNewlyAttachedFile(before, collected);
      }
      productCatalog = await loadProductCatalog(form, collected);
      availableTimeslots = await loadTimeslots(form, collected);

      if (selectionChanged(before, collected)) {
        const refreshed = await refreshPricing(form, collected);
        if (refreshed) {
          collected = { ...collected, confirmedPrice: refreshed.euroTotal };
          pricing = refreshed;
        }
      }
    } else if (current) {
      const accessor = current.accessor ?? current.type;

      if (isUploadFileName(fileName)) {
        return rejectValidation(
          state,
          form,
          collected,
          current,
          userMessage,
          undefined,
          "That looks like a filename. Use the Attach button next to the chat input to upload documents for each product.",
          productCatalog,
          availableTimeslots,
        );
      }

      if (accessor === "products") {
        const needing = getProductsNeedingFiles(collected, productCatalog);
        if (needing.length > 0) {
          return rejectValidation(
            state,
            form,
            collected,
            current,
            userMessage,
            undefined,
            "Please use the Attach button to upload the document for this product.",
            productCatalog,
            availableTimeslots,
            needing[0]!.id,
          );
        }
      }

      if (accessor === "participants") {
        const setup = getParticipantSetup(current);
        const chatAction = parseParticipantsChatMessage(userMessage);
        let nextCollected = collected;

        if (chatAction?.type === "finalize") {
          const rows = normalizedRows(collected.participants);
          const validation = validateParticipantRows(rows, setup);
          if (!validation.ok) {
            return rejectValidation(
              state,
              form,
              collected,
              current,
              userMessage,
              undefined,
              validation.message,
              productCatalog,
              availableTimeslots,
            );
          }
          nextCollected = applyParticipantsChatAction(
            collected,
            chatAction,
            setup,
          );
        } else if (chatAction?.type === "expectMore") {
          nextCollected = applyParticipantsChatAction(
            collected,
            chatAction,
            setup,
          );
        } else if (chatAction?.type === "append") {
          nextCollected = applyParticipantsChatAction(
            collected,
            chatAction,
            setup,
          );
          const validation = validateAnswer(
            current,
            nextCollected.participants,
          );
          if (!validation.ok) {
            return rejectValidation(
              state,
              form,
              collected,
              current,
              userMessage,
              undefined,
              validation.message,
              productCatalog,
              availableTimeslots,
            );
          }
        } else {
          const rows = mergeParticipantRows(normalizedRows(collected.participants), [
            defaultParticipantRow(userMessage.trim()),
          ]);
          const validation = validateAnswer(current, rows);
          if (!validation.ok) {
            return rejectValidation(
              state,
              form,
              collected,
              current,
              userMessage,
              undefined,
              validation.message,
              productCatalog,
              availableTimeslots,
            );
          }
          nextCollected = {
            ...collected,
            participants: rows,
            participantsExpectMore: false,
            participantsFinalized:
              rows.length >= setup.minParticipants &&
              setup.minParticipants <= 1 &&
              rows.length === 1,
          };
        }

        const before = { ...collected };
        collected = nextCollected;
        if (selectionChanged(before, collected)) {
          const refreshed = await refreshPricing(form, collected);
          if (refreshed) {
            collected = { ...collected, confirmedPrice: refreshed.euroTotal };
            pricing = refreshed;
          }
        }
      } else if (isConsentComponent(current)) {
        const config = getConsentConfig(form, collected);
        const parsed = parseConsentTextAnswer(userMessage, collected, config);
        if (!parsed) {
          return rejectValidation(
            state,
            form,
            collected,
            current,
            userMessage,
            undefined,
            "Please accept the terms and conditions to continue.",
            productCatalog,
            availableTimeslots,
          );
        }
        const validation = validateConsentAnswer(config, parsed, collected);
        if (!validation.ok) {
          return rejectValidation(
            state,
            form,
            collected,
            current,
            userMessage,
            undefined,
            validation.message,
            productCatalog,
            availableTimeslots,
          );
        }
        const before = { ...collected };
        collected = applyConsentAnswer(
          form,
          collected,
          parsed,
          config,
          productCatalog,
        );
        if (selectionChanged(before, collected)) {
          const refreshed = await refreshPricing(form, collected);
          if (refreshed) {
            collected = { ...collected, confirmedPrice: refreshed.euroTotal };
            pricing = refreshed;
          }
        }
      } else {
      let extracted: unknown;

      if (accessor === "destinationCountry") {
        const resolution = resolveDestinationCountryAnswer(userMessage, form);
        if (resolution.status === "resolved") {
          extracted = resolution.code;
        } else if (resolution.status === "unsupported") {
          return rejectValidation(
            state,
            form,
            collected,
            current,
            userMessage,
            undefined,
            formatUnsupportedDestinationCountryMessage(form, resolution),
            productCatalog,
            availableTimeslots,
          );
        } else {
          return rejectValidation(
            state,
            form,
            collected,
            current,
            userMessage,
            undefined,
            formatUnmatchedDestinationCountryMessage(form),
            productCatalog,
            availableTimeslots,
          );
        }
      } else {
        extracted = await extractUserAnswer(
          current,
          userMessage,
          form,
          productCatalog,
          availableTimeslots,
          state.collected,
          collected,
        );
        extracted = enrichProductFiles(collected, current, extracted);
      }

      const validation = validateAnswer(current, extracted);
      if (!validation.ok) {
        return rejectValidation(
          state,
          form,
          collected,
          current,
          userMessage,
          undefined,
          validation.message,
          productCatalog,
          availableTimeslots,
        );
      }

      const before = { ...collected };
      collected = applyAnswer(
        form,
        collected,
        current,
        extracted,
        productCatalog,
      );
      collected = deriveParticipants(collected);
      attachedFile = findNewlyAttachedFile(before, collected);
      if (attachedFile) {
        const ownerId = productIdForAttachedFile(collected, attachedFile);
        if (ownerId) {
          sessionFileOwners = withSessionFileOwner(
            sessionFileOwners,
            attachedFile,
            ownerId,
          );
        }
      }
      collected = applyCollectedUpdates(
        form,
        collected,
        productCatalog,
        sessionFiles,
        sessionFileOwners,
      );
      if (!attachedFile) {
        attachedFile = findNewlyAttachedFile(before, collected);
      }
      productCatalog = await loadProductCatalog(form, collected);
      availableTimeslots = await loadTimeslots(form, collected);

      if (selectionChanged(before, collected)) {
        const refreshed = await refreshPricing(form, collected);
        if (refreshed) {
          collected = { ...collected, confirmedPrice: refreshed.euroTotal };
          pricing = refreshed;
        }
      }
      }
    }
  }

  const next = nextUnfilled(form, collected, productCatalog);
  const pendingPreferredNotary = pendingPreferredNotaryComponent(
    form,
    collected,
    productCatalog,
  );

  const turnMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (userMessage.trim() || structuredAnswer) {
    turnMessages.push({
      role: "user",
      content: structuredAnswer ? "Submitted details" : userMessage,
    });
  }
  if (attachedFile) {
    turnMessages.push({
      role: "assistant",
      content: `Got it — attached ${attachedFile} ✅`,
    });
  }

  const newState: EngineState = {
    form,
    collected,
    messages: [...state.messages, ...turnMessages],
    pricing,
    productCatalog,
    availableTimeslots,
    sessionFiles,
    sessionFileOwners,
  };

  if (pendingPreferredNotary) {
    const preferredNotaryStep = buildPreferredNotaryStep(
      form,
      collected,
      productCatalog,
      pricing,
    );
    newState.messages = [
      ...newState.messages,
      { role: "assistant", content: preferredNotaryStep.question },
    ];
    return { state: newState, step: preferredNotaryStep };
  }

  if (!next) {
    collected = applyCollectedUpdates(
      form,
      collected,
      productCatalog,
      sessionFiles,
      sessionFileOwners,
    );
    collected = sanitizeCollected(
      normalizeCollected(form, collected, productCatalog),
    );
    const finalPricing =
      (await refreshPricing(form, collected)) ?? pricing;
    const euroTotal = finalPricing?.euroTotal ?? collected.confirmedPrice ?? 0;
    const payload = AppointmentRequest.parse({
      ...collected,
      confirmedPrice: euroTotal,
    });
    return {
      state: { ...newState, collected, pricing: finalPricing ?? pricing },
      step: { type: "complete", payload },
    };
  }

  if (collected.products?.length && collected.destinationCountry) {
    const refreshed = await refreshPricing(form, collected);
    if (refreshed) {
      collected = { ...collected, confirmedPrice: refreshed.euroTotal };
      pricing = refreshed;
      newState.collected = collected;
      newState.pricing = pricing;
    }
  }

  if (shouldEmitFormStep(next, collected)) {
    const formStep = buildFormStep(next, collected, productCatalog, pricing);
    newState.messages = [
      ...newState.messages,
      { role: "assistant", content: formStep.title },
    ];
    return { state: newState, step: formStep };
  }

  if (shouldEmitParticipantsStep(next)) {
    const participantsStep = buildParticipantsStep(
      next,
      collected,
      getParticipantSetup(next),
      pricing,
    );
    newState.messages = [
      ...newState.messages,
      { role: "assistant", content: participantsStep.title },
    ];
    return { state: newState, step: participantsStep };
  }

  if (shouldEmitConsentStep(next)) {
    const consentStep = buildConsentStep(form, collected, pricing);
    newState.messages = [
      ...newState.messages,
      { role: "assistant", content: consentStep.title },
    ];
    return { state: newState, step: consentStep };
  }

  const step = buildStepFromComponent(
    next,
    form,
    state.collected,
    collected,
    productCatalog,
    availableTimeslots,
    pricing,
  );

  const prompt =
    step.type === "ask" ||
    step.type === "fileUpload" ||
    step.type === "participants" ||
    step.type === "consent"
      ? step.type === "participants" || step.type === "consent"
        ? step.title
        : step.question
      : "";

  newState.messages = [
    ...newState.messages,
    { role: "assistant", content: prompt },
  ];

  return {
    state: newState,
    step,
  };
}

function normalizeEditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return parsePartyStructuredAnswer(value as Record<string, unknown>);
  }
  return value;
}

function pruneSessionOwnersForProducts(
  owners: Record<string, string>,
  products: { id: string; files: string[] }[],
): Record<string, string> {
  const validProductIds = new Set(products.map((product) => product.id));
  const boundFiles = new Set(products.flatMap((product) => product.files));
  const next: Record<string, string> = {};

  for (const [fileName, productId] of Object.entries(owners)) {
    if (validProductIds.has(productId) && boundFiles.has(fileName)) {
      next[fileName] = productId;
    }
  }

  return next;
}

export async function applySurgicalEdit(
  state: EngineState,
  accessor: string,
  value: unknown,
): Promise<{ state: EngineState; step: EngineStep }> {
  const form =
    typeof state.form.id === "string"
      ? state.form
      : parseBookingForm(state.form);

  let collected = applyDefaults(form, state.collected);
  const component = findComponentByAccessor(form, accessor);
  if (!component) {
    throw new Error(`Unknown accessor: ${accessor}`);
  }

  let productCatalog = await loadProductCatalog(form, collected);
  const normalizedValue = normalizeEditValue(value);

  const validation = validateAnswer(component, normalizedValue);
  if (!validation.ok) {
    if (shouldEmitFormStep(component, collected)) {
      return {
        state,
        step: {
          ...buildFormStep(component, collected, productCatalog, state.pricing),
          error: validation.message,
        },
      };
    }
    if (shouldEmitParticipantsStep(component)) {
      return {
        state,
        step: buildParticipantsStep(
          component,
          collected,
          getParticipantSetup(component),
          state.pricing,
          validation.message,
        ),
      };
    }
    const availableTimeslots = await loadTimeslots(form, collected);
    const options = getOptionsForComponent(
      component,
      form,
      productCatalog,
      availableTimeslots,
      state.collected,
      collected,
    );
    return {
      state,
      step: {
        type: "ask",
        accessor,
        question: validation.message,
        options,
        lineItems: state.pricing?.lineItems,
        euroTotal: state.pricing?.euroTotal,
      },
    };
  }

  collected = applyAnswer(
    form,
    collected,
    component,
    normalizedValue,
    productCatalog,
  );
  collected = clearDependentsOf(form, collected, accessor);
  collected = deriveParticipants(collected);
  collected = normalizeCollected(form, collected, productCatalog);

  let sessionFileOwners = { ...(state.sessionFileOwners ?? {}) };
  if (accessor === "products") {
    sessionFileOwners = pruneSessionOwnersForProducts(
      sessionFileOwners,
      collected.products ?? [],
    );
  }

  const sessionFiles = state.sessionFiles ?? [];
  collected = applyCollectedUpdates(
    form,
    collected,
    productCatalog,
    sessionFiles,
    sessionFileOwners,
  );

  productCatalog = await loadProductCatalog(form, collected);
  const availableTimeslots = await loadTimeslots(form, collected);

  let pricing = state.pricing;
  const refreshed = await refreshPricing(form, collected);
  if (refreshed) {
    collected = { ...collected, confirmedPrice: refreshed.euroTotal };
    pricing = refreshed;
  }

  const newState: EngineState = {
    form,
    collected,
    messages: state.messages,
    pricing,
    productCatalog,
    availableTimeslots,
    sessionFiles,
    sessionFileOwners,
  };

  const next = nextUnfilled(form, collected, productCatalog);
  if (!next) {
    collected = sanitizeCollected(
      normalizeCollected(form, collected, productCatalog),
    );
    const finalPricing = (await refreshPricing(form, collected)) ?? pricing;
    const euroTotal = finalPricing?.euroTotal ?? collected.confirmedPrice ?? 0;
    const payload = AppointmentRequest.parse({
      ...collected,
      confirmedPrice: euroTotal,
    });
    return {
      state: { ...newState, collected, pricing: finalPricing ?? pricing },
      step: { type: "complete", payload },
    };
  }

  if (shouldEmitFormStep(next, collected)) {
    return {
      state: newState,
      step: buildFormStep(next, collected, productCatalog, pricing),
    };
  }

  if (shouldEmitParticipantsStep(next)) {
    return {
      state: newState,
      step: buildParticipantsStep(
        next,
        collected,
        getParticipantSetup(next),
        pricing,
      ),
    };
  }

  if (shouldEmitConsentStep(next)) {
    return {
      state: newState,
      step: buildConsentStep(form, collected, pricing),
    };
  }

  return {
    state: newState,
    step: buildStepFromComponent(
      next,
      form,
      state.collected,
      collected,
      productCatalog,
      availableTimeslots,
      pricing,
    ),
  };
}

export async function step(
  state: EngineState,
  userMessage: string,
  structuredAnswer?: Record<string, unknown>,
): Promise<EngineStep> {
  const { step: result } = await advance(state, userMessage, structuredAnswer);
  return result;
}
