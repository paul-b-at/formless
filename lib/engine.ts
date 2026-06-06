import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

import { AppointmentRequest } from "./booking-schema";
import type { AppointmentRequest as AppointmentRequestType } from "./booking-schema";
import {
  applyAnswer,
  componentLabel,
  getTimeslotLabel,
  getVisibleProductPickerTags,
  nextUnfilled,
  parseBookingForm,
  type BookingFormSchema,
  type Collected,
  type Component,
  type ProductDefinition,
} from "./form-interpreter";
import {
  getProductsByTags,
  getTimeslots,
  priceRequest,
  sumNetToEuros,
  type PriceLineItem,
} from "./notarity-api";

const DRAFT_ID = "vfniS9nfoq8nMpRqQj7Z";

export type EngineState = {
  form: BookingFormSchema;
  collected: Collected;
  messages: { role: "user" | "assistant"; content: string }[];
  pricing?: { lineItems: PriceLineItem[]; euroTotal: number };
  productCatalog?: ProductDefinition[];
  availableTimeslots?: { id: string; startTime: string }[];
};

export type EngineStep =
  | {
      type: "ask";
      accessor: string;
      question: string;
      options?: string[];
      lineItems?: PriceLineItem[];
      euroTotal?: number;
    }
  | { type: "complete"; payload: AppointmentRequestType };

const GeminiTurnSchema = z.object({
  extractedValue: z.unknown(),
  nextQuestion: z.string(),
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
    newsletter: false,
    preferredNotary: "",
    instant: false,
    instantNotarisationSupported: false,
    ...collected,
    contactDetails: collected.contactDetails ?? {
      contactDetailsSameAsBillingDetails: true,
    },
  };
}

function normalizeCollected(collected: Collected): Collected {
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
    };
  }

  if (next.hardCopy?.hardCopy === false) {
    delete next.shippingDetails;
  }

  return next;
}

function selectionChanged(
  before: Collected,
  after: Collected,
): boolean {
  return (
    JSON.stringify(before.products) !== JSON.stringify(after.products) ||
    JSON.stringify(before.timeslots) !== JSON.stringify(after.timeslots) ||
    JSON.stringify(before.hardCopy) !== JSON.stringify(after.hardCopy) ||
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
        defs.push({
          id: component.props._product,
          title: { en: "Auto-added product" },
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
  collected: Collected,
  euroTotal: number,
): AppointmentRequestType {
  return AppointmentRequest.parse({
    ...collected,
    confirmedPrice: euroTotal,
  });
}

async function refreshPricing(
  collected: Collected,
): Promise<{ lineItems: PriceLineItem[]; euroTotal: number } | undefined> {
  try {
    const draft = AppointmentRequest.partial().parse(collected);
    if (!draft.products?.length || !draft.destinationCountry) {
      return undefined;
    }
    const lineItems = await priceRequest(
      buildPricingPayload(collected, collected.confirmedPrice ?? 0),
    );
    return { lineItems, euroTotal: sumNetToEuros(lineItems) };
  } catch {
    return undefined;
  }
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
    if (title.includes("nie") && lower.includes("nie") && lower.includes("application")) {
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
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  collected: Collected,
): unknown {
  const accessor = component.accessor ?? component.type;
  const trimmed = message.trim();

  switch (accessor) {
    case "destinationCountry": {
      const map: Record<string, string> = {
        spain: "ES",
        es: "ES",
        austria: "AT",
        at: "AT",
      };
      const key = trimmed.toLowerCase();
      if (map[key]) return map[key];
      if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
      return trimmed;
    }
    case "products": {
      const fileMatch = trimmed.match(/[\w.-]+\.pdf/i);
      if (fileMatch) {
        const fileName = fileMatch[0];
        const existing = collected.products ?? [];
        if (fileName.includes("personal")) {
          const nieData = existing.find((p) => p.id === "xK5IkgPX1LTYdWLFzW8X");
          if (nieData) {
            return { ...nieData, files: [fileName] };
          }
        }
        if (fileName.includes("application")) {
          const nieApp = existing.find((p) => p.id === "UpEJ7raQEKQKFhWn12r2");
          if (nieApp) {
            return { ...nieApp, apostille: true, files: [fileName] };
          }
        }
        const target = existing.find((p) => p.files.length === 0) ?? existing[0];
        if (target) {
          return { ...target, files: [fileName] };
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
      if (/yes|true|hard copy/i.test(trimmed)) {
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
        };
      }
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return trimmed;
      }
    }
    case "billingDetails":
    case "shippingDetails":
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return trimmed;
      }
    case "participants":
      return [{ email: trimmed, client: true, supervisor: false }];
    default:
      return trimmed;
  }
}

async function extractWithGemini(
  component: Component,
  message: string,
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
  collected: Collected,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbackExtract(component, message, catalog, availableTimeslots, collected);
  }

  const ai = new GoogleGenAI({ apiKey });
  const label = componentLabel(component);
  const catalogSummary = catalog
    .map((p) => `${p.id}: ${p.title.en ?? p.id}`)
    .join(", ");
  const slotSummary = availableTimeslots
    .slice(0, 5)
    .map((s) => `${s.id} (${s.startTime})`)
    .join(", ");

  const prompt = `Extract the user's answer for the booking form field "${label}" (accessor: ${component.accessor ?? component.type}, type: ${component.type}).
User message: "${message}"
Available products: ${catalogSummary || "none"}
Available timeslot ids: ${slotSummary || "none"}
Return JSON with extractedValue (typed appropriately for the field) and nextQuestion (a short follow-up if needed, or empty string).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedValue: { type: Type.STRING, nullable: true },
            nextQuestion: { type: Type.STRING },
          },
          required: ["extractedValue", "nextQuestion"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      return fallbackExtract(component, message, catalog, availableTimeslots, collected);
    }

    const parsed = GeminiTurnSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return fallbackExtract(component, message, catalog, availableTimeslots, collected);
    }

    const raw = parsed.data.extractedValue;
    if (typeof raw === "string") {
      return fallbackExtract(
        { ...component, accessor: component.accessor },
        raw,
        catalog,
        availableTimeslots,
        collected,
      );
    }
    return raw;
  } catch {
    return fallbackExtract(component, message, catalog, availableTimeslots, collected);
  }
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
      const products = collected.products ?? [];
      const needingFiles = products.filter((p) => {
        const def = catalog.find((d) => d.id === p.id);
        return def?.fileUploadRequired && p.files.length === 0;
      });
      if (needingFiles.length > 0) {
        const def = catalog.find((d) => d.id === needingFiles[0]?.id);
        const name = def?.title.en ?? needingFiles[0]?.id;
        return `Please provide the required PDF upload for ${name}.`;
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
          .map((s) => s.startTime)
          .join(", ")}`;
      }
      return "When would you like your appointment?";
    case "billingDetails":
      return "Please provide your billing details (name, email, phone, address).";
    case "contactDetails":
      return "Should we use the same contact details as billing? (yes/no)";
    case "hardCopy":
      return "Would you like a hard copy shipped to you?";
    case "shippingDetails":
      return "Please provide your shipping address.";
    case "participants":
      return "Who will participate in the appointment?";
    default:
      return `Please provide: ${label}`;
  }
}

export async function advance(
  state: EngineState,
  userMessage: string,
): Promise<{ state: EngineState; step: EngineStep }> {
  const form =
    typeof state.form.id === "string"
      ? state.form
      : parseBookingForm(state.form);

  let collected = applyDefaults(form, state.collected);
  let pricing = state.pricing;

  let productCatalog = await loadProductCatalog(form, collected);
  let availableTimeslots = await loadTimeslots(form, collected);

  const current = nextUnfilled(form, collected, productCatalog);

  if (userMessage.trim() && current) {
    let extracted = await extractWithGemini(
      current,
      userMessage,
      productCatalog,
      availableTimeslots,
      collected,
    );
    extracted = enrichProductFiles(collected, current, extracted);

    const before = { ...collected };
    collected = applyAnswer(form, collected, current, extracted, productCatalog);
    collected = deriveParticipants(collected);

    if (selectionChanged(before, collected)) {
      const refreshed = await refreshPricing(collected);
      if (refreshed) {
        collected = { ...collected, confirmedPrice: refreshed.euroTotal };
        pricing = refreshed;
      }
    }
  }

  const next = nextUnfilled(form, collected, productCatalog);

  const newState: EngineState = {
    form,
    collected,
    messages: [
      ...state.messages,
      ...(userMessage.trim()
        ? [{ role: "user" as const, content: userMessage }]
        : []),
    ],
    pricing,
    productCatalog,
    availableTimeslots,
  };

  if (!next) {
    collected = normalizeCollected(collected);
    const finalPricing = pricing ?? (await refreshPricing(collected));
    const euroTotal = finalPricing?.euroTotal ?? collected.confirmedPrice ?? 0;
    const payload = AppointmentRequest.parse({
      ...collected,
      confirmedPrice: euroTotal,
    });
    return {
      state: { ...newState, pricing: finalPricing ?? pricing },
      step: { type: "complete", payload },
    };
  }

  if (collected.products?.length) {
    const refreshed = await refreshPricing(collected);
    if (refreshed) {
      pricing = refreshed;
      newState.pricing = refreshed;
      newState.collected = { ...collected, confirmedPrice: refreshed.euroTotal };
    }
  }

  const question = formatQuestion(
    next,
    productCatalog,
    availableTimeslots,
    newState.collected,
  );
  newState.messages = [
    ...newState.messages,
    { role: "assistant", content: question },
  ];

  return {
    state: newState,
    step: {
      type: "ask",
      accessor: next.accessor ?? next.type,
      question,
      options:
        next.type === "productPicker"
          ? productCatalog.map((p) => p.title.en ?? p.id)
          : next.type === "timeSlots"
            ? availableTimeslots.map((s) => s.id)
            : undefined,
      lineItems: pricing?.lineItems,
      euroTotal: pricing?.euroTotal,
    },
  };
}

export async function step(
  state: EngineState,
  userMessage: string,
): Promise<EngineStep> {
  const { step: result } = await advance(state, userMessage);
  return result;
}
