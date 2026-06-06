import { describe, expect, test } from "bun:test";

import {
  sanitizeAppointmentPayload,
  sanitizeCollected,
  sanitizeParty,
} from "../party-sanitize";

describe("sanitizeParty", () => {
  test("converts empty optional strings to omitted fields", () => {
    const result = sanitizeParty({
      firstName: "Joshua",
      lastName: "Timms",
      email: "joshua.timms@notarity.com",
      business: false,
      phoneNumber: "+12125550174",
      countryCode: "",
    });

    expect(result.countryCode).toBeUndefined();
    expect(result.phoneNumber).toBe("+12125550174");
    expect("countryCode" in result).toBe(false);
  });

  test("defaults countryCode from destinationCountry when blank", () => {
    const result = sanitizeParty(
      {
        firstName: "Joshua",
        lastName: "Timms",
        email: "joshua.timms@notarity.com",
        business: false,
      },
      { destinationCountry: "ES", defaultCountry: true },
    );

    expect(result.countryCode).toBe("ES");
  });
});

describe("sanitizeCollected", () => {
  test("sanitizes billing and contact without adding countryCode to same-as-billing contact", () => {
    const result = sanitizeCollected({
      destinationCountry: "ES",
      billingDetails: {
        firstName: "Joshua",
        lastName: "Timms",
        business: false,
        email: "joshua.timms@notarity.com",
        countryCode: "",
      },
      contactDetails: {
        contactDetailsSameAsBillingDetails: true,
        firstName: "Joshua",
        lastName: "Timms",
        business: false,
        email: "joshua.timms@notarity.com",
      },
    });

    expect(result.billingDetails?.countryCode).toBe("ES");
    expect(result.contactDetails?.countryCode).toBeUndefined();
  });
});

describe("sanitizeAppointmentPayload", () => {
  test("passes zod-ready billing when countryCode was empty string", () => {
    const sanitized = sanitizeAppointmentPayload({
      destinationCountry: "ES",
      billingDetails: {
        firstName: "Joshua",
        lastName: "Timms",
        business: false,
        email: "joshua.timms@notarity.com",
        countryCode: "",
      },
      contactDetails: {
        contactDetailsSameAsBillingDetails: true,
        firstName: "Joshua",
        lastName: "Timms",
        business: false,
        email: "joshua.timms@notarity.com",
        countryCode: "",
      },
    }) as {
      billingDetails: { countryCode?: string };
      contactDetails: { countryCode?: string };
    };

    expect(sanitized.billingDetails.countryCode).toBe("ES");
    expect(sanitized.contactDetails.countryCode).toBeUndefined();
  });
});
