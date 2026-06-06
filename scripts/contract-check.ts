/**
 * Contract check: prices the known-good Joshua/Spain payload against staging.
 * Side-effect free — calls POST /price only (no submit, no emails).
 *
 * Run: bun run scripts/contract-check.ts
 */

// Import from notarity-api (same implementation as lib/notarity.ts; server-only blocks Bun scripts)
import { priceRequest, sumNetToEuros } from "../lib/notarity-api";
import type { AppointmentRequest } from "../lib/booking-schema";

const joshuaPayload: AppointmentRequest = {
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
  timeslots: ["xitTkTMC18R0ZfCNtqyW"],
  instantNotarisationSupported: false,
  instant: false,
  timezone: "Europe/Vienna",
  billingDetails: {
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
  },
  contactDetails: {
    contactDetailsSameAsBillingDetails: true,
    firstName: "Joshua",
    lastName: "Timms",
    business: false,
    email: "joshua.timms@notarity.com",
    phoneNumber: "+12125550174",
  },
  shippingDetails: {
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
  },
  preferredNotary: "",
};

async function main(): Promise<void> {
  console.log("Contract check: pricing Joshua/Spain payload against staging…");

  const lineItems = await priceRequest(joshuaPayload);
  const euroTotal = sumNetToEuros(lineItems);

  console.log("Line items:", JSON.stringify(lineItems, null, 2));
  console.log(`Euro total: €${euroTotal}`);
}

main().catch((error: unknown) => {
  console.error("Contract check failed:", error);
  process.exit(1);
});
