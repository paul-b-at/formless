/**
 * Engine replay: cross-border PoA with two signatories + express hard-copy shipping.
 * No submit — prices only at the end.
 *
 * Run: OCR_MOCK=1 bun run engine-replay-twosigner
 */

import { AppointmentRequest, type ProductSelection } from "../lib/booking-schema";
import {
  advance,
  getEngineGeminiCallCount,
  resetEngineGeminiCallCount,
  type EngineState,
  type EngineStep,
} from "../lib/engine";
import { isValidEmail } from "../lib/field-validation";
import {
  getVisibleProductPickerTags,
  parseBookingForm,
  type BookingFormSchema,
  type Collected,
  type ProductDefinition,
} from "../lib/form-interpreter";
import { readOcrCache } from "../lib/ocr-cache";
import { describeRememberedEmailPrefill } from "../lib/remembered-email";
import { PROOF_OF_REPRESENTATION_ACCESSOR } from "../lib/product-proof";
import { getBookingForm, getProductsByTags, priceRequest, sumNetToEuros } from "../lib/notarity";

const ROBERT_EMAIL = "robert.stevens@notarity.com";
const SECOND_SIGNER_EMAIL = "elena.petrova@notarity.com";
const ROBERT_PDF = "Robert_Stevens_sample_case.pdf";
/** Canonical slot when staging still lists it; otherwise replay uses first available. */
const PREFERRED_TIMESLOT_ID = "g1p4klJSyUYqt2SwoFa3";

let selectedTimeslotId: string | undefined;
let poaProductTitle = "Signature notarisation";

const ROBERT_BILLING = {
  firstName: "Robert",
  lastName: "Stevens",
  business: false,
  email: ROBERT_EMAIL,
  phoneNumber: "+43 678 122 0282",
  address: "Savanorių pr. 120",
  zipCode: "44148",
  city: "Kaunas",
  stateProvince: "Kauno apskr.",
  countryCode: "LT",
};

type ScriptedAnswer =
  | { kind: "text"; value: string }
  | { kind: "form"; value: Record<string, unknown> };

function buildAnswerQueues(productTitle: string): Record<string, ScriptedAnswer[]> {
  return {
    destinationCountry: [{ kind: "text", value: "Lithuania (LT)" }],
    products: [{ kind: "text", value: productTitle }],
    participants: [
      {
        kind: "form",
        value: {
          participants: [
            { email: ROBERT_EMAIL, client: true, supervisor: false },
            { email: SECOND_SIGNER_EMAIL, client: true, supervisor: false },
          ],
          finalize: true,
        },
      },
    ],
    [PROOF_OF_REPRESENTATION_ACCESSOR]: [
      { kind: "text", value: "Yes, include proof of representation" },
    ],
    timeslots: [],
    billingDetails: [{ kind: "form", value: ROBERT_BILLING }],
    contactDetails: [{ kind: "text", value: "Same as billing" }],
    hardCopy: [
      { kind: "text", value: "Yes, send a hard copy with express shipping" },
    ],
    shippingDetails: [{ kind: "text", value: "Same as billing address" }],
  };
}

async function loadProductCatalog(
  form: BookingFormSchema,
  collected: Collected,
): Promise<ProductDefinition[]> {
  const tags = getVisibleProductPickerTags(form, collected);
  if (tags.length === 0) {
    return [];
  }
  const products = await getProductsByTags(tags);
  return products.map((product) => {
    const record = product as Record<string, unknown>;
    return {
      id: String(record.id ?? record._id ?? ""),
      title: {
        en:
          typeof record.title === "object" && record.title !== null
            ? String((record.title as Record<string, unknown>).en ?? "")
            : String(record.title ?? record.name ?? record.id ?? ""),
      },
      showProofOfRepresentation: Boolean(record.showProofOfRepresentation),
      proofOfRepresentationRequired: Boolean(record.proofOfRepresentationRequired),
    };
  });
}

function findPoAProductOnPayload(
  products: ProductSelection[],
  catalog: ProductDefinition[],
): ProductSelection {
  const matches = products.filter((product) => {
    const def = catalog.find((entry) => entry.id === product.id);
    return def?.showProofOfRepresentation === true;
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one showProofOfRepresentation product, got ${matches.length}`,
    );
  }

  return matches[0]!;
}

function tomorrowIsoDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextScriptedAnswer(
  step: EngineStep,
  state: EngineState,
  answerQueues: Record<string, ScriptedAnswer[]>,
): { userMessage: string; structuredAnswer?: Record<string, unknown> } {
  if (step.type === "form") {
    const queue = answerQueues[step.accessor];
    const next = queue?.shift();
    if (!next || next.kind !== "form") {
      throw new Error(`No form answer for accessor: ${step.accessor}`);
    }
    return { userMessage: "", structuredAnswer: next.value };
  }

  if (step.type === "fileUpload") {
    throw new Error(
      `Two-signer PoA flow should not require file upload; got product ${step.productId}`,
    );
  }

  if (step.type === "participants") {
    const queue = answerQueues.participants;
    const next = queue?.shift();
    if (!next) {
      throw new Error("No scripted answer for accessor: participants");
    }
    if (next.kind === "form") {
      return { userMessage: "", structuredAnswer: next.value };
    }
    throw new Error("Expected form answer for participants");
  }

  if (step.type === "datePicker") {
    return {
      userMessage: "",
      structuredAnswer: { date: tomorrowIsoDate() },
    };
  }

  if (step.type !== "ask") {
    throw new Error(
      `Expected ask, participants, form, or datePicker step, got ${step.type}`,
    );
  }

  const accessor = step.accessor;
  if (accessor === "preferredNotary") {
    return { userMessage: "No preference" };
  }
  if (accessor === "timeslots") {
    const slots = state.availableTimeslots ?? [];
    const preferred = slots.find((slot) => slot.id === PREFERRED_TIMESLOT_ID);
    selectedTimeslotId = preferred?.id ?? slots[0]?.id;
    if (!selectedTimeslotId) {
      throw new Error("No available timeslots returned from API");
    }
    return { userMessage: selectedTimeslotId };
  }

  const queue = answerQueues[accessor];
  const next = queue?.shift();
  if (!next || next.kind !== "text") {
    throw new Error(`No scripted answer for accessor: ${accessor}`);
  }
  return { userMessage: next.value };
}

function assertTwoSignerPoAPayload(
  payload: AppointmentRequest,
  catalog: ProductDefinition[],
): AppointmentRequest {
  const parsed = AppointmentRequest.parse(payload);

  if (parsed.destinationCountry !== "LT") {
    throw new Error(
      `Expected destinationCountry LT, got ${parsed.destinationCountry}`,
    );
  }

  if (parsed.participants.length !== 2) {
    throw new Error(
      `Expected participants.length === 2, got ${parsed.participants.length}`,
    );
  }

  const emails = parsed.participants.map((row) => row.email).sort();
  const expected = [ROBERT_EMAIL, SECOND_SIGNER_EMAIL].sort();
  if (JSON.stringify(emails) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected participant emails ${expected.join(", ")}, got ${emails.join(", ")}`,
    );
  }

  for (const participant of parsed.participants) {
    if (!isValidEmail(participant.email)) {
      throw new Error(`Invalid participant email: ${participant.email}`);
    }
    if (!participant.client || participant.supervisor) {
      throw new Error(
        `Expected client:true supervisor:false, got ${JSON.stringify(participant)}`,
      );
    }
  }

  const poaProduct = findPoAProductOnPayload(parsed.products, catalog);
  if (poaProduct.proofOfRepresentation !== true) {
    throw new Error(
      `Expected proofOfRepresentation true on PoA product, got ${String(poaProduct.proofOfRepresentation)}`,
    );
  }

  if (parsed.hardCopy.expressShipping !== true) {
    throw new Error(
      `Expected hardCopy.expressShipping === true, got ${String(parsed.hardCopy.expressShipping)}`,
    );
  }
  if (parsed.hardCopy.hardCopy !== true) {
    throw new Error(
      `Expected hardCopy.hardCopy === true for express hard-copy shipping, got ${String(parsed.hardCopy.hardCopy)}`,
    );
  }

  if (!parsed.shippingDetails) {
    throw new Error("Expected shippingDetails when hardCopy.hardCopy is true");
  }

  if (parsed.mode !== "debug") {
    throw new Error(`Expected mode debug, got ${parsed.mode}`);
  }
  if (parsed._appointmentRequestDraft !== "vfniS9nfoq8nMpRqQj7Z") {
    throw new Error("Missing or wrong _appointmentRequestDraft");
  }

  if (parsed.timeslots.length !== 1 || !parsed.timeslots[0]?.trim()) {
    throw new Error(
      `Expected one timeslot id from API, got ${JSON.stringify(parsed.timeslots)}`,
    );
  }
  if (selectedTimeslotId && parsed.timeslots[0] !== selectedTimeslotId) {
    throw new Error(
      `Expected selected timeslot ${selectedTimeslotId}, got ${parsed.timeslots[0]}`,
    );
  }

  return parsed;
}

async function main(): Promise<void> {
  resetEngineGeminiCallCount();

  console.log(
    "Engine replay: two-signer cross-border PoA + express hard copy…\n",
  );

  const ocr = readOcrCache(ROBERT_PDF);
  if (!ocr) {
    throw new Error(
      `OCR mock missing for ${ROBERT_PDF}. Add fixtures/ocr/Robert_Stevens_sample_case.json.`,
    );
  }

  poaProductTitle = ocr.productTitle?.trim() || poaProductTitle;

  console.log(
    `OCR mock: country=${ocr.destinationCountry ?? "—"} productTitle=${poaProductTitle} confidence=${ocr.productConfidence ?? "—"}\n`,
  );
  for (const line of describeRememberedEmailPrefill(ROBERT_EMAIL, [
    "participants[0].email",
    "billingDetails.email",
    "contactDetails.email",
  ])) {
    console.log(`Remembered email prefill: ${line}`);
  }
  console.log("");

  const rawForm = await getBookingForm("start-vienna-hackathon");
  const form = parseBookingForm(rawForm);
  const catalog = await loadProductCatalog(form, { destinationCountry: "LT" });

  const catalogMatch = catalog.find(
    (product) =>
      product.title.en?.trim().toLowerCase() === poaProductTitle.toLowerCase(),
  );
  if (!catalogMatch) {
    throw new Error(
      `PoA product "${poaProductTitle}" not found in live catalog for LT`,
    );
  }
  if (!catalogMatch.showProofOfRepresentation) {
    throw new Error(
      `Catalog product "${poaProductTitle}" does not show proof of representation`,
    );
  }
  console.log(
    `Resolved PoA product from catalog: ${catalogMatch.title.en} (${catalogMatch.id})\n`,
  );

  const answerQueues = buildAnswerQueues(poaProductTitle);

  let state: EngineState = {
    form,
    collected: {},
    messages: [],
  };

  let userMessage = "";
  let structuredAnswer: Record<string, unknown> | undefined;
  const maxTurns = 40;

  for (let turn = 0; turn < maxTurns; turn++) {
    const { state: nextState, step: result } = await advance(
      state,
      userMessage,
      structuredAnswer,
    );
    state = nextState;
    structuredAnswer = undefined;

    if (result.type === "complete") {
      const parsed = assertTwoSignerPoAPayload(result.payload, catalog);
      const lineItems = await priceRequest(parsed);
      const euroTotal = sumNetToEuros(lineItems);
      const poaProduct = findPoAProductOnPayload(parsed.products, catalog);

      console.log(`\nCOMPLETE — confirmedPrice: €${parsed.confirmedPrice}`);
      console.log(`Price API total: €${euroTotal}`);
      console.log("Line items:", JSON.stringify(lineItems, null, 2));
      console.log("Participants:", JSON.stringify(parsed.participants, null, 2));
      console.log("hardCopy:", JSON.stringify(parsed.hardCopy, null, 2));
      console.log(
        "proofOfRepresentation:",
        poaProduct.proofOfRepresentation,
        `(product ${catalogMatch.title.en})`,
      );
      console.log("Timeslot:", parsed.timeslots[0]);
      if (parsed.timeslots[0] !== PREFERRED_TIMESLOT_ID) {
        console.log(
          `  (canonical ${PREFERRED_TIMESLOT_ID} not in current API slots — used first available)`,
        );
      }

      if (euroTotal !== parsed.confirmedPrice) {
        console.error(
          `Price mismatch: confirmedPrice €${parsed.confirmedPrice} vs API €${euroTotal}`,
        );
        process.exit(1);
      }

      console.log("\nEngine replay (two-signer PoA) passed.");
      console.log(`Gemini API calls this run: ${getEngineGeminiCallCount()}`);
      return;
    }

    const label =
      result.type === "form"
        ? `FORM [${result.accessor}]: ${result.title}`
        : result.type === "participants"
          ? `PARTICIPANTS [${result.accessor}]: ${result.title}`
          : result.type === "fileUpload"
            ? `UPLOAD [${result.productId}] ${result.productLabel}: ${result.question}`
            : result.type === "datePicker"
              ? `DATE [${result.accessor}]: ${result.title}`
              : `ASK [${result.accessor}]: ${result.question}`;
    console.log(label);
    if (result.euroTotal !== undefined) {
      console.log(`  (running price: €${result.euroTotal})`);
    }
    if (result.type === "ask" && result.options?.length) {
      console.log(
        `  options: ${result.options.map((option) => option.label).join(" | ")}`,
      );
    }

    const scripted = nextScriptedAnswer(result, state, answerQueues);
    userMessage = scripted.userMessage;
    structuredAnswer = scripted.structuredAnswer;

    console.log(
      scripted.structuredAnswer
        ? `ANSWER: [form] ${JSON.stringify(scripted.structuredAnswer)}`
        : `ANSWER: ${userMessage}`,
    );
    console.log();
  }

  console.error("Exceeded max turns without completing");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("Engine replay (two-signer PoA) failed:", error);
  process.exit(1);
});
