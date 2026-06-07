import { describe, expect, test } from "bun:test";

import { PARTY_FORM_FIELDS } from "../engine";
import { buildPartyFormPrefill } from "../ocr-party-prefill";
import {
  captureRememberedEmail,
  describeRememberedEmailPrefill,
  extractEmailFromStructuredAnswer,
} from "../remembered-email";

describe("remembered-email", () => {
  test("captures the first valid email from a chat message", () => {
    expect(
      captureRememberedEmail(null, "joshua.timms@notarity.com", undefined),
    ).toBe("joshua.timms@notarity.com");
  });

  test("keeps the first email and ignores later submissions", () => {
    expect(
      captureRememberedEmail(
        "joshua.timms@notarity.com",
        "other@example.com",
        undefined,
      ),
    ).toBe("joshua.timms@notarity.com");
  });

  test("captures email from participant structured answers", () => {
    expect(
      captureRememberedEmail(null, "", {
        participants: [{ email: "elizabeth.midgley@notarity.com", client: true }],
        finalize: true,
      }),
    ).toBe("elizabeth.midgley@notarity.com");
  });

  test("captures email from billing form structured answers", () => {
    expect(
      captureRememberedEmail(null, "", {
        email: "robert.stevens@notarity.com",
        firstName: "Robert",
      }),
    ).toBe("robert.stevens@notarity.com");
  });

  test("does not capture invalid addresses", () => {
    expect(captureRememberedEmail(null, "not-an-email", undefined)).toBeNull();
    expect(extractEmailFromStructuredAnswer({ email: "bad" })).toBeNull();
  });

  test("remembered email overrides OCR email on billing forms", () => {
    const prefill = buildPartyFormPrefill(
      {
        firstName: "Elizabeth",
        email: "elizabeth.midgley@notarity.com",
      },
      "user.entered@notarity.com",
      PARTY_FORM_FIELDS,
    );

    expect(prefill.defaults.email).toBe("user.entered@notarity.com");
    expect(prefill.suggestedFieldLabels.email).toBe("Suggested");
    expect(prefill.defaults.firstName).toBe("Elizabeth");
    expect(prefill.suggestedFieldLabels.firstName).toBe("From your document");
  });

  test("describes remembered-email prefill targets", () => {
    expect(
      describeRememberedEmailPrefill("joshua.timms@notarity.com", [
        "participants[0].email",
        "billingDetails.email",
      ]),
    ).toEqual([
      "rememberedEmail → participants[0].email: joshua.timms@notarity.com",
      "rememberedEmail → billingDetails.email: joshua.timms@notarity.com",
    ]);
  });
});
