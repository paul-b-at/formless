/**
 * Engine replay: reproduces Joshua/Spain flow without UI.
 * No submit — prices only at the end.
 *
 * Run: bun run scripts/engine-replay.ts
 */

import type { AppointmentRequest } from "../lib/booking-schema";
import { advance, type EngineState } from "../lib/engine";
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

async function main(): Promise<void> {
  console.log("Engine replay: Joshua/Spain flow…\n");

  const rawForm = await getBookingForm("start-vienna-hackathon");
  const form = parseBookingForm(rawForm);

  let state: EngineState = {
    form,
    collected: {},
    messages: [],
  };

  const answerQueues: Record<string, string[]> = {
    destinationCountry: ["ES"],
    products: [
      "NIE number application",
      "nie-application-demo-joshua_timms.pdf",
      "nie_personal_details.pdf",
    ],
    participants: ["joshua.timms@notarity.com"],
    timeslots: [],
    billingDetails: [JSON.stringify(JOSHUA_BILLING)],
    contactDetails: ["same as billing"],
    hardCopy: ["yes hard copy please"],
    shippingDetails: [JSON.stringify(JOSHUA_SHIPPING)],
  };

  let userMessage = "";
  const maxTurns = 30;

  for (let turn = 0; turn < maxTurns; turn++) {
    const { state: nextState, step: result } = await advance(state, userMessage);
    state = nextState;

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

      console.log("\nEngine replay passed.");
      return;
    }

    console.log(`ASK [${result.accessor}]: ${result.question}`);
    if (result.euroTotal !== undefined) {
      console.log(`  (running price: €${result.euroTotal})`);
    }

    const accessor = result.accessor;
    if (accessor === "timeslots") {
      const slotId = nextState.availableTimeslots?.[0]?.id;
      if (!slotId) {
        throw new Error("No available timeslots returned from API");
      }
      userMessage = slotId;
    } else {
      const queue = answerQueues[accessor];
      const next = queue?.shift();
      if (!next) {
        throw new Error(`No scripted answer for accessor: ${accessor}`);
      }
      userMessage = next;
    }

    console.log(`ANSWER: ${userMessage}\n`);
  }

  console.error("Exceeded max turns without completing");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("Engine replay failed:", error);
  process.exit(1);
});
