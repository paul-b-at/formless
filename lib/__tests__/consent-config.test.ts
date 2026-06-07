import { describe, expect, test } from "bun:test";

import {
  getConsentConfig,
  isConsentComponent,
  pendingConsentComponents,
} from "../consent-config";
import { parseBookingForm, type BookingFormSchema } from "../form-interpreter";

const summaryPageForm: BookingFormSchema = parseBookingForm({
  id: "test-form",
  pages: [
    {
      title: { en: "Summary" },
      slug: "summary",
      components: [
        { id: "summary-1", type: "summary" },
        { id: "newsletter-1", type: "newsletter", accessor: "newsletter" },
        { id: "terms-1", type: "confirmTC", props: {} },
      ],
    },
  ],
});

const optionalTermsForm: BookingFormSchema = parseBookingForm({
  id: "test-form-optional",
  pages: [
    {
      title: { en: "Summary" },
      slug: "summary",
      components: [
        { id: "terms-optional", type: "confirmTC", props: { required: false } },
      ],
    },
  ],
});

describe("consent-config", () => {
  test("isConsentComponent detects newsletter and confirmTC", () => {
    expect(
      isConsentComponent({
        id: "n1",
        type: "newsletter",
        accessor: "newsletter",
      }),
    ).toBe(true);
    expect(isConsentComponent({ id: "t1", type: "confirmTC" })).toBe(true);
    expect(
      isConsentComponent({
        id: "c1",
        type: "countryPicker",
        accessor: "destinationCountry",
      }),
    ).toBe(false);
  });

  test("getConsentConfig detects newsletter and required terms on summary page", () => {
    const config = getConsentConfig(summaryPageForm);
    expect(config.showNewsletter).toBe(true);
    expect(config.termsRequired).toBe(true);
    expect(config.newsletterComponent?.id).toBe("newsletter-1");
    expect(config.termsComponent?.id).toBe("terms-1");
  });

  test("termsRequired is false when confirmTC props.required is false", () => {
    const config = getConsentConfig(optionalTermsForm);
    expect(config.termsRequired).toBe(false);
    expect(config.showNewsletter).toBe(false);
  });

  test("pendingConsentComponents lists unfilled consent fields", () => {
    const pending = pendingConsentComponents(summaryPageForm, {});
    expect(pending.map((component) => component.type).sort()).toEqual([
      "confirmTC",
      "newsletter",
    ]);

    const filled = pendingConsentComponents(summaryPageForm, {
      newsletter: false,
      termsAccepted: true,
    });
    expect(filled).toHaveLength(0);
  });
});
