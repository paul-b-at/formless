/**
 * Engine replay: reproduces Joshua/Spain flow without UI.
 * No submit — prices only at the end.
 *
 * Run: bun run scripts/engine-replay.ts
 */

import type { AppointmentRequest } from "../lib/booking-schema";
import {
  advance,
  getEngineGeminiCallCount,
  resetEngineGeminiCallCount,
  type EngineState,
  type EngineStep,
} from "../lib/engine";
import { parseBookingForm } from "../lib/form-interpreter";
import { getBookingForm, priceRequest, sumNetToEuros } from "../lib/notarity-api";

const JOSHUA_BILLING = {
  firstName: "Joshua",
  lastName: "Timms",
  business: false,
  email: "joshua.timms@notarity.com",
  phoneNumber: "+12125550174",
  address: "5th Ave 350",
  zipCode: "10118",
  city: "New York",
  stateProvince: "NY",
  countryCode: "US",
};

const JOSHUA_SHIPPING = {
  shippingDetailsSameAsBillingDetails: false,
  firstName: "Joshua",
  lastName: "Timms",
  business: false,
  email: "joshua.timms@notarity.com",
  phoneNumber: "+12125550174",
  address: "Carrer de Mallorca 401",
  zipCode: "08013",
  city: "Barcelona",
  stateProvince: "CT",
  countryCode: "ES",
};

function buildExpectedPayload(timeslotId: string): AppointmentRequest {
  return {
    _bookingForm: "kmVXjYM937qB8JTYG2yH",
    language: "en",
    origin:
      "https://staging.notarity.com/#/my-companies/HpKfHmbViXxFEMzjtxln/appointment-requests",
    confirmedPrice: 580,
    hardCopy: { expressShipping: false, hardCopy: true },
    newsletter: false,
    mode: "debug",
    _appointmentRequestDraft: "vfniS9nfoq8nMpRqQj7Z",
    destinationCountry: "ES",
    products: [
      {
        id: "UpEJ7raQEKQKFhWn12r2",
        apostille: true,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["nie-application-demo-joshua_timms.pdf"],
      },
      {
        id: "xK5IkgPX1LTYdWLFzW8X",
        apostille: null,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["nie_personal_details.pdf"],
      },
    ],
    participants: [
      { email: "joshua.timms@notarity.com", client: true, supervisor: false },
    ],
    timeslots: [timeslotId],
    instantNotarisationSupported: false,
    instant: false,
    timezone: "Europe/Vienna",
    billingDetails: JOSHUA_BILLING,
    contactDetails: {
      contactDetailsSameAsBillingDetails: true,
      firstName: "Joshua",
      lastName: "Timms",
      business: false,
      email: "joshua.timms@notarity.com",
      phoneNumber: "+12125550174",
    },
    shippingDetails: JOSHUA_SHIPPING,
    preferredNotary: "",
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function deepEqualPayload(
  actual: AppointmentRequest,
  expected: AppointmentRequest,
): string[] {
  const diffs: string[] = [];
  const keys = new Set([
    ...Object.keys(actual),
    ...Object.keys(expected),
  ]) as Set<keyof AppointmentRequest>;

  for (const key of keys) {
    if (key === "confirmedPrice") {
      continue;
    }
    const aJson = stableStringify(actual[key]);
    const eJson = stableStringify(expected[key]);
    if (aJson !== eJson) {
      diffs.push(`${String(key)}: expected ${eJson}, got ${aJson}`);
    }
  }
  return diffs;
}

type ScriptedAnswer =
  | { kind: "text"; value: string }
  | { kind: "form"; value: Record<string, unknown> };

const answerQueues: Record<string, ScriptedAnswer[]> = {
  destinationCountry: [{ kind: "text", value: "Spain (ES)" }],
  products: [
    { kind: "text", value: "NIE number application" },
    { kind: "text", value: "nie-application-demo-joshua_timms.pdf" },
    { kind: "text", value: "nie_personal_details.pdf" },
  ],
  participants: [{ kind: "text", value: "joshua.timms@notarity.com" }],
  timeslots: [],
  billingDetails: [{ kind: "form", value: JOSHUA_BILLING }],
  contactDetails: [{ kind: "text", value: "Same as billing" }],
  hardCopy: [{ kind: "text", value: "Yes, send a hard copy" }],
  shippingDetails: [
    { kind: "text", value: "Different shipping address" },
    { kind: "form", value: JOSHUA_SHIPPING },
  ],
};

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
    const queue = answerQueues.products;
    const next = queue?.shift();
    if (!next || next.kind !== "text") {
      throw new Error(`No scripted file upload for product: ${step.productId}`);
    }
    return { userMessage: next.value };
  }

  if (step.type !== "ask") {
    throw new Error(`Expected ask or fileUpload step, got ${step.type}`);
  }

  const accessor = step.accessor;
  if (accessor === "timeslots") {
    const slotId = state.availableTimeslots?.[0]?.id;
    if (!slotId) {
      throw new Error("No available timeslots returned from API");
    }
    return { userMessage: slotId };
  }

  const queue = answerQueues[accessor];
  const next = queue?.shift();
  if (!next || next.kind !== "text") {
    throw new Error(`No scripted answer for accessor: ${accessor}`);
  }
  return { userMessage: next.value };
}

async function main(): Promise<void> {
  resetEngineGeminiCallCount();

  console.log("Engine replay: Joshua/Spain flow…\n");

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
      const timeslotId = payload.timeslots[0] ?? "";
      const expected = buildExpectedPayload(timeslotId);
      const diffs = deepEqualPayload(payload, expected);

      if (diffs.length > 0) {
        console.error("Payload mismatches:");
        for (const d of diffs) {
          console.error(`  - ${d}`);
        }
        process.exit(1);
      }

      const lineItems = await priceRequest(payload);
      const euroTotal = sumNetToEuros(lineItems);

      console.log(`\nCOMPLETE — confirmedPrice: €${payload.confirmedPrice}`);
      console.log(`Price API total: €${euroTotal}`);
      console.log("Line items:", JSON.stringify(lineItems, null, 2));

      if (euroTotal !== 580) {
        console.error(`Expected €580, got €${euroTotal}`);
        process.exit(1);
      }

      if (payload.confirmedPrice !== 580) {
        console.error(
          `Expected confirmedPrice €580, got €${payload.confirmedPrice}`,
        );
        process.exit(1);
      }

      console.log("\nEngine replay passed.");
      console.log(`Gemini API calls this run: ${getEngineGeminiCallCount()}`);
      return;
    }

    const label =
      result.type === "form"
        ? `FORM [${result.accessor}]: ${result.title}`
        : result.type === "fileUpload"
          ? `UPLOAD [${result.productId}] ${result.productLabel}: ${result.question}`
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
  console.error("Engine replay failed:", error);
  process.exit(1);
});
