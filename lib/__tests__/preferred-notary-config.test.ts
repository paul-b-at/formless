import { describe, expect, test } from "bun:test";

import {
  explainPreferredNotaryPath,
  formatPreferredNotaryPathLog,
  getPreferredNotaryConfig,
  isPreferredNotaryRelevant,
  PREFERRED_NOTARY_DEFAULT,
  preferredNotaryDisplayLabel,
  resolvePreferredNotaryValue,
} from "../preferred-notary-config";
import { parseBookingForm } from "../form-interpreter";

const formWithPicker = parseBookingForm({
  id: "test",
  pages: [
    {
      title: { en: "Summary" },
      slug: "summary",
      components: [
        {
          id: "pn",
          type: "preferredNotary",
          props: {
            countries: ["AT"],
            notaries: [
              { id: "notary-at-1", name: "Vienna Notary" },
            ],
          },
        },
      ],
    },
  ],
});

const formWithoutOptions = parseBookingForm({
  id: "test",
  pages: [
    {
      title: { en: "Summary" },
      slug: "summary",
      components: [{ id: "pn", type: "preferredNotary", props: {} }],
    },
  ],
});

describe("preferred-notary-config", () => {
  test("empty props do not surface a picker", () => {
    const config = getPreferredNotaryConfig(formWithoutOptions, {
      destinationCountry: "AT",
      products: [
        {
          id: "p1",
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        },
      ],
    });
    expect(config.showPicker).toBe(false);
    expect(resolvePreferredNotaryValue(formWithoutOptions, {
      destinationCountry: "AT",
      preferredNotary: "oops",
    })).toBe(PREFERRED_NOTARY_DEFAULT);
  });

  test("picker is relevant only for matching country with configured notaries", () => {
    const component = formWithPicker.pages[0]!.components[0]!;
    expect(
      isPreferredNotaryRelevant(component, { destinationCountry: "AT" }, []),
    ).toBe(true);
    expect(
      isPreferredNotaryRelevant(component, { destinationCountry: "ES" }, []),
    ).toBe(false);
  });

  test("invalid preferredNotary values fall back to default", () => {
    expect(
      resolvePreferredNotaryValue(
        formWithPicker,
        {
          destinationCountry: "AT",
          preferredNotary: "unknown-id",
        },
        [],
      ),
    ).toBe(PREFERRED_NOTARY_DEFAULT);
  });

  test("empty props log skip reason for live-style config", () => {
    const report = explainPreferredNotaryPath(formWithoutOptions, {
      destinationCountry: "ES",
      products: [{ id: "UpEJ7raQEKQKFhWn12r2", apostille: true, files: [] }],
    });
    expect(report.showPicker).toBe(false);
    expect(report.skipReason).toContain("no notary options");
    expect(formatPreferredNotaryPathLog(report)).toContain('preferredNotary=""');
  });

  test("preferredNotaryDisplayLabel maps ids and default", () => {
    const config = getPreferredNotaryConfig(formWithPicker, {
      destinationCountry: "AT",
    });
    expect(preferredNotaryDisplayLabel("", config)).toBe("No preference");
    expect(preferredNotaryDisplayLabel("notary-at-1", config)).toBe(
      "Vienna Notary",
    );
  });
});
