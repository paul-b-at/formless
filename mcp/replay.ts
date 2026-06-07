/**
 * MCP adapter replay — Joshua/Spain through booking-session handlers.
 * Asserts per-product file binding, email-step filename rejection, and €580.
 *
 * Run: bun run mcp/replay.ts
 */

import {
  answerBooking,
  getBookingPrice,
  resetBookingSessions,
  startBooking,
} from "./booking-session";

const NIE_APPLICATION_ID = "UpEJ7raQEKQKFhWn12r2";
const NIE_PERSONAL_ID = "xK5IkgPX1LTYdWLFzW8X";
const APPLICATION_FILE = "nie-application-demo-joshua_timms.pdf";
const PERSONAL_FILE = "nie_personal_details.pdf";

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

type ScriptedAnswer =
  | { kind: "text"; value: string }
  | { kind: "file"; value: string; productId: string }
  | { kind: "form"; value: Record<string, unknown> };

const productPickerQueue: ScriptedAnswer[] = [
  { kind: "text", value: "NIE number application" },
];

const productFileQueue: ScriptedAnswer[] = [
  {
    kind: "file",
    value: APPLICATION_FILE,
    productId: NIE_APPLICATION_ID,
  },
  {
    kind: "file",
    value: PERSONAL_FILE,
    productId: NIE_PERSONAL_ID,
  },
];

const answerQueues: Record<string, ScriptedAnswer[]> = {
  destinationCountry: [{ kind: "text", value: "Spain (ES)" }],
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
  step: Awaited<ReturnType<typeof startBooking>>["step"],
  state: Awaited<ReturnType<typeof startBooking>>["state"],
): Parameters<typeof answerBooking>[0] | null {
  if (step.type === "form") {
    const queue = answerQueues[step.accessor];
    const next = queue?.shift();
    if (!next || next.kind !== "form") {
      throw new Error(`No form answer for accessor: ${step.accessor}`);
    }
    return {
      sessionId: "",
      userMessage: "",
      structuredAnswer: next.value,
    };
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
      sessionId: "",
      userMessage: next.value,
      uploadKind: "file",
      uploadProductId: next.productId,
    };
  }

  if (step.type !== "ask") {
    throw new Error(`Expected ask, fileUpload, or form step, got ${step.type}`);
  }

  const accessor = step.accessor;
  if (accessor === "timeslots") {
    const slotId = state.availableTimeslots?.[0]?.id;
    if (!slotId) {
      throw new Error("No available timeslots returned from API");
    }
    return { sessionId: "", userMessage: slotId };
  }

  if (accessor === "products") {
    const next = productPickerQueue.shift();
    if (!next || next.kind !== "text") {
      throw new Error("No scripted product picker answer");
    }
    return { sessionId: "", userMessage: next.value };
  }

  const queue = answerQueues[accessor];
  const next = queue?.shift();
  if (!next || next.kind !== "text") {
    throw new Error(`No scripted answer for accessor: ${accessor}`);
  }
  return { sessionId: "", userMessage: next.value };
}

function assertNoCrossProductReuse(
  products: { id: string; files: string[] }[] | undefined,
): void {
  const application = products?.find((entry) => entry.id === NIE_APPLICATION_ID);
  const personal = products?.find((entry) => entry.id === NIE_PERSONAL_ID);

  if (application?.files.some((file) => file === PERSONAL_FILE)) {
    throw new Error("Cross-product reuse: application product has personal file");
  }
  if (personal?.files.some((file) => file === APPLICATION_FILE)) {
    throw new Error("Cross-product reuse: personal product has application file");
  }
}

function assertDistinctProductFiles(
  products: { id: string; files: string[] }[] | undefined,
): void {
  const application = products?.find((entry) => entry.id === NIE_APPLICATION_ID);
  const personal = products?.find((entry) => entry.id === NIE_PERSONAL_ID);

  if (!application?.files.includes(APPLICATION_FILE)) {
    throw new Error(
      `NIE application missing ${APPLICATION_FILE}: ${JSON.stringify(application?.files)}`,
    );
  }
  if (!personal?.files.includes(PERSONAL_FILE)) {
    throw new Error(
      `NIE Personal Data missing ${PERSONAL_FILE}: ${JSON.stringify(personal?.files)}`,
    );
  }
  assertNoCrossProductReuse(products);
}

async function main(): Promise<void> {
  resetBookingSessions();
  console.log("MCP replay: Joshua/Spain via booking-session handlers…\n");

  const started = await startBooking();
  let sessionId = started.sessionId;
  let step = started.step;
  let state = started.state;

  const maxTurns = 40;
  let emailRejectPassed = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (step.type === "complete") {
      break;
    }

    if (
      step.type === "ask" &&
      step.accessor === "participants" &&
      !emailRejectPassed
    ) {
      const reject = await answerBooking({
        sessionId,
        userMessage: PERSONAL_FILE,
      });
      if (
        reject.step.type !== "ask" ||
        reject.step.accessor !== "participants" ||
        !reject.step.question.toLowerCase().includes("filename")
      ) {
        throw new Error(
          `Expected participants step to reject filename; got ${JSON.stringify(reject.step)}`,
        );
      }
      console.log("PASS — filename rejected on participants email step");
      emailRejectPassed = true;
      step = reject.step;
      state = reject.state;
      continue;
    }

    const scripted = nextScriptedAnswer(step, state);
    if (!scripted) {
      throw new Error(`No scripted answer for step ${step.type}`);
    }

    const answered = await answerBooking({ ...scripted, sessionId });
    state = answered.state;
    step = answered.step;

    console.log(
      step.type === "fileUpload"
        ? `UPLOAD [${step.productId}] ${step.productLabel}`
        : step.type === "form"
          ? `FORM [${step.accessor}]`
          : step.type === "ask"
            ? `ASK [${step.accessor}]`
            : step.type === "complete"
              ? "COMPLETE"
              : String(step.type),
    );

    if (state.collected.products?.some((product) => product.files.length > 0)) {
      assertNoCrossProductReuse(state.collected.products);
    }

    if (step.type === "complete") {
      break;
    }
  }

  if (step.type !== "complete") {
    throw new Error(`Replay did not complete within ${maxTurns} turns`);
  }

  if (!emailRejectPassed) {
    throw new Error("Email filename rejection test did not run");
  }

  assertDistinctProductFiles(step.payload.products);

  const priced = await getBookingPrice(sessionId);
  if (!priced.ok) {
    throw new Error(`get_price failed: ${priced.issues?.join(", ")}`);
  }

  if (priced.euroTotal !== 580) {
    throw new Error(`Expected €580, got €${priced.euroTotal}`);
  }

  console.log("\nMCP replay passed.");
  console.log(`  Distinct files: ${APPLICATION_FILE} + ${PERSONAL_FILE}`);
  console.log("  Email step rejects filename: yes");
  console.log(`  get_price total: €${priced.euroTotal}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
