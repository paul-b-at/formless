import { describe, expect, test } from "bun:test";

import {
  isValidEmail,
  isValidPhone,
  validateAnswer,
  validatePartyFormValues,
} from "../field-validation";

describe("field validation", () => {
  test("rejects participant filename masquerading as email", () => {
    const result = validateAnswer(
      { id: "p1", type: "participants", accessor: "participants" },
      [{ email: "nie_personal_details.pdf", client: true, supervisor: false }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("filename");
    }
  });

  test("rejects invalid participant email", () => {
    const result = validateAnswer(
      { id: "p1", type: "participants", accessor: "participants" },
      [{ email: "asdf", client: true, supervisor: false }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("valid email");
    }
  });

  test("accepts valid participant email", () => {
    const result = validateAnswer(
      { id: "p1", type: "participants", accessor: "participants" },
      [{ email: "joshua.timms@notarity.com", client: true, supervisor: false }],
    );
    expect(result.ok).toBe(true);
  });

  test("rejects invalid email in any participant row", () => {
    const result = validateAnswer(
      { id: "p1", type: "participants", accessor: "participants" },
      [
        { email: "signer1@test.com", client: true, supervisor: false },
        { email: "not-valid", client: true, supervisor: false },
      ],
    );
    expect(result.ok).toBe(false);
  });

  test("rejects duplicate participant emails", () => {
    const result = validateAnswer(
      { id: "p1", type: "participants", accessor: "participants" },
      [
        { email: "same@test.com", client: true, supervisor: false },
        { email: "same@test.com", client: true, supervisor: false },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("unique");
    }
  });

  test("requires phone on billing party form", () => {
    const result = validateAnswer(
      { id: "b1", type: "billingDetails", accessor: "billingDetails" },
      {
        firstName: "Joshua",
        lastName: "Timms",
        email: "joshua.timms@notarity.com",
        phoneNumber: "",
        business: false,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("phone");
    }
  });

  test("validatePartyFormValues catches bad email and missing phone", () => {
    const errors = validatePartyFormValues(
      {
        firstName: "Joshua",
        lastName: "Timms",
        email: "not-an-email",
        phoneNumber: "",
      },
      [
        { name: "firstName", required: true },
        { name: "lastName", required: true },
        { name: "email", required: true },
        { name: "phoneNumber", required: true },
      ],
    );
    expect(errors.email).toBeDefined();
    expect(errors.phoneNumber).toBeDefined();
  });

  test("isValidEmail and isValidPhone helpers", () => {
    expect(isValidEmail("joshua.timms@notarity.com")).toBe(true);
    expect(isValidEmail("asdf")).toBe(false);
    expect(isValidPhone("+12125550174")).toBe(true);
    expect(isValidPhone("   ")).toBe(false);
  });
});
