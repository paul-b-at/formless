/**
 * Engine replay: Robert Stevens / Lithuania PoA flow without UI.
 * No submit — prices only at the end.
 *
 * Run: OCR_MOCK=1 bun run scripts/engine-replay-robert.ts
 */

import { AppointmentRequest } from "../lib/booking-schema";
import {
  advance,
  getEngineGeminiCallCount,
  resetEngineGeminiCallCount,
  type EngineState,
  type EngineStep,
} from "../lib/engine";
import { parseBookingForm } from "../lib/form-interpreter";
import { readOcrCache } from "../lib/ocr-cache";
import { describeRememberedEmailPrefill } from "../lib/remembered-email";
import { getBookingForm, priceRequest, sumNetToEuros } from "../lib/notarity";

const ROBERT_EMAIL = "robert.stevens@notarity.com";
const ROBERT_PDF = "Robert_Stevens_sample_case.pdf";
/** Canonical Robert slot when staging still lists it; otherwise replay uses first available. */
const ROBERT_TIMESLOT_ID = "g1p4klJSyUYqt2SwoFa3";

let selectedTimeslotId: string | undefined;

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

const answerQueues: Record<string, ScriptedAnswer[]> = {
  destinationCountry: [{ kind: "text", value: "Lithuania (LT)" }],
  products: [{ kind: "text", value: "Signature notarisation" }],
  participants: [{ kind: "text", value: ROBERT_EMAIL }],
  timeslots: [],
  billingDetails: [{ kind: "form", value: ROBERT_BILLING }],
  contactDetails: [{ kind: "text", value: "Same as billing" }],
  hardCopy: [{ kind: "text", value: "No hard copy needed" }],
};

function tomorrowIsoDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextScriptedAnswer(
  step: EngineStep,
  state: EngineState,
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
      `Robert flow should not require file upload; got product ${step.productId}`,
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
      `Expected ask, participants, form, or datePicker step, got ${step.type}`,
    );
  }

  const accessor = step.accessor;
  if (accessor === "preferredNotary") {
    return { userMessage: "No preference" };
  }
  if (accessor === "timeslots") {
    const slots = state.availableTimeslots ?? [];
    const preferred = slots.find((slot) => slot.id === ROBERT_TIMESLOT_ID);
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

function assertRobertPayload(payload: AppointmentRequest): void {
  const parsed = AppointmentRequest.parse(payload);

  if (parsed.destinationCountry !== "LT") {
    throw new Error(
      `Expected destinationCountry LT, got ${parsed.destinationCountry}`,
    );
  }

  if (parsed.participants.length !== 1) {
    throw new Error(
      `Expected exactly one participant, got ${parsed.participants.length}`,
    );
  }

  const participant = parsed.participants[0];
  if (!participant) {
    throw new Error("Expected one participant row");
  }
  if (participant.email !== ROBERT_EMAIL) {
    throw new Error(`Expected participant ${ROBERT_EMAIL}, got ${participant.email}`);
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
  if (parsed.timezone !== "Europe/Vienna") {
    throw new Error(`Expected timezone Europe/Vienna, got ${parsed.timezone}`);
  }

  if (parsed.hardCopy.hardCopy !== false || parsed.hardCopy.expressShipping !== false) {
    throw new Error(`Expected no hard copy, got ${JSON.stringify(parsed.hardCopy)}`);
  }

  if (!parsed.contactDetails.contactDetailsSameAsBillingDetails) {
    throw new Error("Expected contactDetailsSameAsBillingDetails true");
  }

  if (parsed.billingDetails.business !== false) {
    throw new Error("Expected private billing (business: false)");
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

  for (const product of parsed.products) {
    if (product.files.length > 0) {
      throw new Error(`Expected no uploaded files, got ${product.files.join(", ")}`);
    }
    if (product.apostille !== null) {
      throw new Error(
        `Expected apostille null, got ${String(product.apostille)}`,
      );
    }
    if (product.proofOfRepresentation) {
      throw new Error(
        `Expected proofOfRepresentation null/false, got ${product.proofOfRepresentation}`,
      );
    }
    if (product.documentsNotReadyYet) {
      throw new Error("Expected documentsNotReadyYet false");
    }
    if (product.needHelpDrafting) {
      throw new Error("Expected needHelpDrafting false");
    }
  }
}

async function main(): Promise<void> {
  resetEngineGeminiCallCount();

  console.log("Engine replay: Robert Stevens / Lithuania flow…\n");

  const ocr = readOcrCache(ROBERT_PDF);
  if (!ocr) {
    throw new Error(
      `OCR mock missing for ${ROBERT_PDF}. Add fixtures/ocr/Robert_Stevens_sample_case.json.`,
    );
  }
  console.log(
    `OCR mock: country=${ocr.destinationCountry ?? "—"} suggestedProductId=${ocr.suggestedProductId ?? ocr.productId ?? "—"} confidence=${ocr.productConfidence ?? "—"}\n`,
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

  let state: EngineState = {
    form,
    collected: {},
    messages: [],
  };

  let userMessage = "";
  let structuredAnswer: Record<string, unknown> | undefined;
  const maxTurns = 30;

  for (let turn = 0; turn < maxTurns; turn++) {
    const { state: nextState, step: result } = await advance(
      state,
      userMessage,
      structuredAnswer,
    );
    state = nextState;
    structuredAnswer = undefined;

    if (result.type === "complete") {
      const payload = result.payload;
      assertRobertPayload(payload);

      const lineItems = await priceRequest(payload);
      const euroTotal = sumNetToEuros(lineItems);

      console.log(`\nCOMPLETE — confirmedPrice: €${payload.confirmedPrice}`);
      console.log(`Price API total: €${euroTotal}`);
      console.log("Line items:", JSON.stringify(lineItems, null, 2));
      console.log("Payload products:", JSON.stringify(payload.products, null, 2));
      console.log("Timeslot:", payload.timeslots[0]);
      if (payload.timeslots[0] !== ROBERT_TIMESLOT_ID) {
        console.log(
          `  (canonical ${ROBERT_TIMESLOT_ID} not in current API slots — used first available)`,
        );
      }
      console.log("Participants:", JSON.stringify(payload.participants, null, 2));

      if (euroTotal !== 120) {
        console.error(`Expected €120, got €${euroTotal}`);
        process.exit(1);
      }

      if (payload.confirmedPrice !== 120) {
        console.error(
          `Expected confirmedPrice €120, got €${payload.confirmedPrice}`,
        );
        process.exit(1);
      }

      console.log("\nEngine replay (Robert) passed.");
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
  console.error("Engine replay (Robert) failed:", error);
  process.exit(1);
});
