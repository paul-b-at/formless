import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PARTY_FORM_FIELDS, buildPartyFormFields } from "../engine";
import {
  buildPartyFormPrefill,
  buildPartyPrefillDefaults,
  describePartyPrefillMapping,
  primaryParticipantEmailSuggestion,
} from "../ocr-party-prefill";
import { normalizeOcrResponse } from "../ocr-types";

const BILLING_FIELDS = [
  {
    name: "business",
    label: "Business / company billing",
    type: "checkbox" as const,
    defaultValue: "true",
  },
  ...PARTY_FORM_FIELDS,
  { name: "companyName", label: "Company name", type: "text" as const, required: true },
  { name: "vat", label: "VAT number (optional)", type: "text" as const },
];

describe("ocr-party-prefill", () => {
  test("maps only OCR-returned party fields onto billing form defaults", () => {
    const party = {
      firstName: "Elizabeth",
      lastName: "Midgley",
      email: "elizabeth.midgley@notarity.com",
      address: "Finsbury Square 14",
      city: "London",
      countryCode: "GB",
      companyName: "Midgley Tech Ltd",
    };

    const defaults = buildPartyPrefillDefaults(party, BILLING_FIELDS);

    expect(defaults).toEqual({
      firstName: "Elizabeth",
      lastName: "Midgley",
      email: "elizabeth.midgley@notarity.com",
      address: "Finsbury Square 14",
      city: "London",
      countryCode: "GB",
      companyName: "Midgley Tech Ltd",
    });
    expect(defaults.phoneNumber).toBeUndefined();
    expect(defaults.business).toBeUndefined();
  });

  test("does not invent values for missing OCR fields", () => {
    const defaults = buildPartyPrefillDefaults(
      { firstName: "Joshua", lastName: "Timms", address: "5th Ave 350" },
      PARTY_FORM_FIELDS,
    );

    expect(defaults).toEqual({
      firstName: "Joshua",
      lastName: "Timms",
      address: "5th Ave 350",
    });
  });

  test("Elizabeth fixture maps billing fields for FlexCo doc", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/ocr/elizabeth-flexco.json"),
        "utf8",
      ),
    );
    const ocr = normalizeOcrResponse(raw);
    const mapping = describePartyPrefillMapping(
      ocr.extracted?.party,
      BILLING_FIELDS,
    );

    expect(mapping).toEqual([
      "extracted.party.firstName → firstName: Elizabeth",
      "extracted.party.lastName → lastName: Midgley",
      "extracted.party.email → email: elizabeth.midgley@notarity.com",
      "extracted.party.address → address: Finsbury Square 14",
      "extracted.party.city → city: London",
      "extracted.party.countryCode → countryCode: GB",
      "extracted.party.companyName → companyName: Midgley Tech Ltd",
    ]);
  });

  test("contact and shipping forms reuse the same party field mapping", () => {
    const party = {
      firstName: "Robert",
      lastName: "Stevens",
      address: "Savanorių pr. 120",
      zipCode: "44148",
      city: "Kaunas",
      stateProvince: "Kauno apskr.",
      countryCode: "LT",
    };

    const defaults = buildPartyPrefillDefaults(party, PARTY_FORM_FIELDS);
    expect(defaults.zipCode).toBe("44148");
    expect(defaults.stateProvince).toBe("Kauno apskr.");
  });

  test("primary participant suggestion prefers remembered email over OCR", () => {
    expect(
      primaryParticipantEmailSuggestion({
        rememberedEmail: "user@notarity.com",
        ocrParty: { email: "ocr@notarity.com" },
      }),
    ).toEqual({ value: "user@notarity.com", label: "Suggested" });

    expect(
      primaryParticipantEmailSuggestion({
        rememberedEmail: null,
        ocrParty: { email: "ocr@notarity.com" },
      }),
    ).toEqual({ value: "ocr@notarity.com", label: "From your document" });
  });

  test("buildPartyFormPrefill applies remembered email without OCR party", () => {
    const prefill = buildPartyFormPrefill(
      undefined,
      "joshua.timms@notarity.com",
      PARTY_FORM_FIELDS,
    );

    expect(prefill.defaults).toEqual({
      email: "joshua.timms@notarity.com",
    });
    expect(prefill.suggestedFields).toEqual(["email"]);
    expect(prefill.suggestedFieldLabels.email).toBe("Suggested");
  });

  test("buildPartyFormFields business billing includes companyName mapping target", () => {
    const fields = buildPartyFormFields(
      { accessor: "billingDetails", type: "billingDetails", props: {} },
      {
        destinationCountry: "AT",
        products: [{ id: "S3N2zyJENFE0vTjrKTZn" }],
      },
      [
        {
          id: "S3N2zyJENFE0vTjrKTZn",
          title: { en: "FlexCo Incorporation" },
          description: { en: "Establish a FlexCo online" },
        },
      ],
    );

    expect(fields.some((field) => field.name === "companyName")).toBe(true);
  });
});
