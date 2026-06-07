/**
 * Engine replay: Elizabeth Midgley / Austrian FlexCo flow without UI.
 * No submit — prices only at the end.
 *
 * Run: OCR_MOCK=1 bun run scripts/engine-replay-elizabeth.ts
 */

import { AppointmentRequest } from "../lib/booking-schema";
import {
  advance,
  getEngineGeminiCallCount,
  resetEngineGeminiCallCount,
  type EngineState,
  type EngineStep,
} from "../lib/engine";
import {
  buildPartyFormFields,
  getPartyFormFieldsForAccessor,
} from "../lib/engine";
import { parseBookingForm, type Collected } from "../lib/form-interpreter";
import { describePartyPrefillMapping } from "../lib/ocr-party-prefill";
import { normalizeOcrParty } from "../lib/ocr-types";
import { describeRememberedEmailPrefill } from "../lib/remembered-email";
import { readOcrCache } from "../lib/ocr-cache";
import { getBookingForm, priceRequest, sumNetToEuros } from "../lib/notarity";

const ELIZABETH_EMAIL = "elizabeth.midgley@notarity.com";
const ELIZABETH_PDF = "Gesellschaftsvertrag_Midgley_Tech_EU_FlexCo.pdf";
const FLEXCO_PRODUCT_ID = "S3N2zyJENFE0vTjrKTZn";

const ELIZABETH_BILLING = {
  firstName: "Elizabeth",
  lastName: "Midgley",
  business: true,
  email: ELIZABETH_EMAIL,
  phoneNumber: "+447911123456",
  address: "Finsbury Square 14",
  zipCode: "EC2A 2AH",
  city: "London",
  stateProvince: "England",
  countryCode: "GB",
  businessDetails: {
    companyName: "Midgley Tech Ltd",
    vat: "",
  },
};

type ScriptedAnswer =
  | { kind: "text"; value: string }
  | { kind: "form"; value: Record<string, unknown> }
  | { kind: "file"; value: string; productId: string };

const productPickerQueue: ScriptedAnswer[] = [
  { kind: "text", value: "FlexCo Incorporation" },
];

const productFileQueue: ScriptedAnswer[] = [
  { kind: "file", value: ELIZABETH_PDF, productId: FLEXCO_PRODUCT_ID },
];

const answerQueues: Record<string, ScriptedAnswer[]> = {
  destinationCountry: [{ kind: "text", value: "Austria (AT)" }],
  participants: [{ kind: "text", value: ELIZABETH_EMAIL }],
  timeslots: [],
  billingDetails: [{ kind: "form", value: ELIZABETH_BILLING }],
  contactDetails: [{ kind: "text", value: "Same as billing" }],
  hardCopy: [
    { kind: "text", value: "Express shipping only, no hard copy" },
  ],
};

function tomorrowIsoDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextScriptedAnswer(
  step: EngineStep,
  state: EngineState,
): {
  userMessage: string;
  structuredAnswer?: Record<string, unknown>;
  uploadProductId?: string;
  uploadKind?: "file";
} {
  if (step.type === "form") {
    const queue = answerQueues[step.accessor];
    const next = queue?.shift();
    if (!next || next.kind !== "form") {
      throw new Error(`No form answer for accessor: ${step.accessor}`);
    }
    return { userMessage: "", structuredAnswer: next.value };
  }

  if (step.type === "fileUpload") {
    const next = productFileQueue.shift();
    if (!next || next.kind !== "file") {
      throw new Error(`No scripted file upload for product: ${step.productId}`);
    }
    if (next.productId !== step.productId) {
      throw new Error(
        `File upload product mismatch: expected ${step.productId}, queue has ${next.productId}`,
      );
    }
    return {
      userMessage: next.value,
      uploadKind: "file",
      uploadProductId: next.productId,
    };
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
    if (next.kind !== "text") {
      throw new Error("Expected text or form answer for participants");
    }
    return { userMessage: next.value };
  }

  if (step.type === "datePicker") {
    return {
      userMessage: "",
      structuredAnswer: { date: tomorrowIsoDate() },
    };
  }

  if (step.type !== "ask") {
    throw new Error(
      `Expected ask, participants, fileUpload, form, or datePicker step, got ${step.type}`,
    );
  }

  const accessor = step.accessor;
  if (accessor === "preferredNotary") {
    return { userMessage: "No preference" };
  }
  if (accessor === "timeslots") {
    const slotId = state.availableTimeslots?.[0]?.id;
    if (!slotId) {
      throw new Error("No available timeslots returned from API");
    }
    return { userMessage: slotId };
  }

  if (accessor === "products") {
    const next = productPickerQueue.shift();
    if (!next || next.kind !== "text") {
      throw new Error("No scripted product picker answer");
    }
    return { userMessage: next.value };
  }

  const queue = answerQueues[accessor];
  const next = queue?.shift();
  if (!next || next.kind !== "text") {
    throw new Error(`No scripted answer for accessor: ${accessor}`);
  }
  return { userMessage: next.value };
}

function assertElizabethPayload(payload: AppointmentRequest): void {
  const parsed = AppointmentRequest.parse(payload);

  if (parsed.destinationCountry !== "AT") {
    throw new Error(
      `Expected destinationCountry AT, got ${parsed.destinationCountry}`,
    );
  }
  if (parsed.language !== "en") {
    throw new Error(`Expected language en, got ${parsed.language}`);
  }

  if (parsed.products.length !== 1) {
    throw new Error(
      `Expected exactly one product, got ${parsed.products.length}`,
    );
  }

  const product = parsed.products[0]!;
  if (product.id !== FLEXCO_PRODUCT_ID) {
    throw new Error(`Expected FlexCo product ${FLEXCO_PRODUCT_ID}, got ${product.id}`);
  }
  if (product.apostille !== null) {
    throw new Error(`Expected apostille null, got ${String(product.apostille)}`);
  }
  if (!product.files.includes(ELIZABETH_PDF)) {
    throw new Error(
      `Expected uploaded file ${ELIZABETH_PDF}, got ${product.files.join(", ")}`,
    );
  }
  if (product.proofOfRepresentation !== null) {
    throw new Error(
      `Expected proofOfRepresentation null, got ${String(product.proofOfRepresentation)}`,
    );
  }

  if (parsed.timeslots.length !== 1 || !parsed.timeslots[0]?.trim()) {
    throw new Error(
      `Expected one timeslot id from API, got ${JSON.stringify(parsed.timeslots)}`,
    );
  }

  if (parsed.participants.length !== 1) {
    throw new Error(
      `Expected exactly one participant, got ${parsed.participants.length}`,
    );
  }

  const participant = parsed.participants[0]!;
  if (participant.email !== ELIZABETH_EMAIL) {
    throw new Error(
      `Expected participant ${ELIZABETH_EMAIL}, got ${participant.email}`,
    );
  }
  if (!participant.client || participant.supervisor) {
    throw new Error(
      `Expected client:true supervisor:false, got ${JSON.stringify(participant)}`,
    );
  }

  if (parsed.mode !== "debug") {
    throw new Error(`Expected mode debug, got ${parsed.mode}`);
  }
  if (parsed._appointmentRequestDraft !== "vfniS9nfoq8nMpRqQj7Z") {
    throw new Error("Missing or wrong _appointmentRequestDraft");
  }
  if (parsed._bookingForm !== "kmVXjYM937qB8JTYG2yH") {
    throw new Error(`Unexpected _bookingForm ${parsed._bookingForm}`);
  }
  if (parsed.timezone !== "Europe/Vienna") {
    throw new Error(`Expected timezone Europe/Vienna, got ${parsed.timezone}`);
  }
  if (parsed.newsletter !== false) {
    throw new Error(`Expected newsletter false, got ${parsed.newsletter}`);
  }
  if (parsed.preferredNotary !== "") {
    throw new Error(`Expected preferredNotary empty, got ${parsed.preferredNotary}`);
  }

  if (parsed.hardCopy.hardCopy !== false || parsed.hardCopy.expressShipping !== true) {
    throw new Error(
      `Expected hardCopy false + expressShipping true, got ${JSON.stringify(parsed.hardCopy)}`,
    );
  }

  if (!parsed.contactDetails.contactDetailsSameAsBillingDetails) {
    throw new Error("Expected contactDetailsSameAsBillingDetails true");
  }

  if (parsed.billingDetails.business !== true) {
    throw new Error("Expected business billing (business: true)");
  }
  if (parsed.billingDetails.businessDetails?.companyName !== "Midgley Tech Ltd") {
    throw new Error(
      `Expected companyName Midgley Tech Ltd, got ${parsed.billingDetails.businessDetails?.companyName}`,
    );
  }
  if (parsed.billingDetails.businessDetails?.vat !== "") {
    throw new Error(
      `Expected empty vat, got ${parsed.billingDetails.businessDetails?.vat}`,
    );
  }
  if (parsed.contactDetails.business !== true) {
    throw new Error("Expected business contact details");
  }
  if (parsed.contactDetails.businessDetails?.companyName !== "Midgley Tech Ltd") {
    throw new Error(
      `Expected contact businessDetails companyName Midgley Tech Ltd, got ${parsed.contactDetails.businessDetails?.companyName}`,
    );
  }

  if (parsed.shippingDetails !== undefined) {
    throw new Error(
      `Expected no shippingDetails when hardCopy is false, got ${JSON.stringify(parsed.shippingDetails)}`,
    );
  }
}

async function attachOptionalProductFile(
  state: EngineState,
): Promise<EngineState> {
  const pending = productFileQueue[0];
  if (!pending || pending.kind !== "file") {
    return state;
  }

  const { state: nextState } = await advance(
    state,
    pending.value,
    undefined,
    pending.productId,
    "file",
  );
  productFileQueue.shift();
  return nextState;
}

async function main(): Promise<void> {
  resetEngineGeminiCallCount();

  console.log("Engine replay: Elizabeth Midgley / Austrian FlexCo flow…\n");

  const ocr = readOcrCache(ELIZABETH_PDF);
  if (!ocr) {
    throw new Error(
      `OCR mock missing for ${ELIZABETH_PDF}. Add fixtures/ocr/elizabeth-flexco.json.`,
    );
  }
  console.log(
    `OCR mock: country=${ocr.destinationCountry ?? "—"} suggestedProductId=${ocr.suggestedProductId ?? ocr.productId ?? "—"} confidence=${ocr.productConfidence ?? "—"}\n`,
  );

  const rawForm = await getBookingForm("start-vienna-hackathon");
  const form = parseBookingForm(rawForm);

  const flexCoCollected: Collected = {
    destinationCountry: "AT",
    products: [
      {
        id: FLEXCO_PRODUCT_ID,
        files: [],
        apostille: null,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
      },
    ],
  };
  const billingComponent = form.pages
    .flatMap((page) => page.components)
    .find((component) => (component.accessor ?? component.type) === "billingDetails");
  const billingFields = billingComponent
    ? buildPartyFormFields(billingComponent, flexCoCollected, [])
    : getPartyFormFieldsForAccessor(form, "billingDetails", flexCoCollected, []);
  const prefillLines = describePartyPrefillMapping(
    normalizeOcrParty(ocr.extracted?.party) ?? undefined,
    billingFields,
  );
  console.log("OCR party prefill mapping (billing):");
  for (const line of prefillLines) {
    console.log(`  ${line}`);
  }
  const rememberedLines = describeRememberedEmailPrefill(ELIZABETH_EMAIL, [
    "participants[0].email",
    "billingDetails.email",
    "contactDetails.email",
  ]);
  console.log("Remembered email prefill (after user enters at participants):");
  for (const line of rememberedLines) {
    console.log(`  ${line}`);
  }
  console.log("");

  let state: EngineState = {
    form,
    collected: {},
    messages: [],
  };

  let userMessage = "";
  let structuredAnswer: Record<string, unknown> | undefined;
  let uploadProductId: string | undefined;
  let uploadKind: "file" | undefined;
  const maxTurns = 30;

  for (let turn = 0; turn < maxTurns; turn++) {
    const { state: nextState, step: result } = await advance(
      state,
      userMessage,
      structuredAnswer,
      uploadProductId,
      uploadKind,
    );
    state = nextState;
    structuredAnswer = undefined;
    uploadProductId = undefined;
    uploadKind = undefined;

    const flexCoNeedsFile = state.collected.products?.some(
      (product) =>
        product.id === FLEXCO_PRODUCT_ID && product.files.length === 0,
    );
    if (flexCoNeedsFile && productFileQueue.length > 0) {
      state = await attachOptionalProductFile(state);
    }

    if (result.type === "complete") {
      const payload = result.payload;
      assertElizabethPayload(payload);

      const lineItems = await priceRequest(payload);
      const euroTotal = sumNetToEuros(lineItems);

      console.log(`\nCOMPLETE — confirmedPrice: €${payload.confirmedPrice}`);
      console.log(`Price API total: €${euroTotal}`);
      console.log("Line items:", JSON.stringify(lineItems, null, 2));
      console.log("Payload products:", JSON.stringify(payload.products, null, 2));
      console.log("Timeslot:", payload.timeslots[0]);
      console.log("Billing:", JSON.stringify(payload.billingDetails, null, 2));

      console.log("\nEngine replay (Elizabeth) passed.");
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

    const scripted = nextScriptedAnswer(result, state);
    userMessage = scripted.userMessage;
    structuredAnswer = scripted.structuredAnswer;
    uploadProductId = scripted.uploadProductId;
    uploadKind = scripted.uploadKind;

    console.log(
      scripted.structuredAnswer
        ? `ANSWER: [form] ${JSON.stringify(scripted.structuredAnswer)}`
        : scripted.uploadKind === "file"
          ? `ANSWER: [file → ${scripted.uploadProductId}] ${userMessage}`
          : `ANSWER: ${userMessage}`,
    );
    console.log();
  }

  console.error("Exceeded max turns without completing");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("Engine replay (Elizabeth) failed:", error);
  process.exit(1);
});
