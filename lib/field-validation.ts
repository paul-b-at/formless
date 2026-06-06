import { z } from "zod";

import { isUploadFileName, type Component } from "./form-interpreter";

const EmailSchema = z.string().email();
const PhoneSchema = z.string().min(1);

export function isValidEmail(value: unknown): boolean {
  return EmailSchema.safeParse(value).success;
}

export function isValidPhone(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return PhoneSchema.safeParse(value.trim()).success;
}

function extractParticipantEmail(value: unknown): string | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first === "object" && "email" in first) {
      const email = (first as { email: unknown }).email;
      return typeof email === "string" ? email.trim() : undefined;
    }
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return undefined;
}

function isSameAsBillingParty(
  accessor: string,
  party: Record<string, unknown>,
): boolean {
  if (accessor === "contactDetails") {
    return party.contactDetailsSameAsBillingDetails === true;
  }
  if (accessor === "shippingDetails") {
    return party.shippingDetailsSameAsBillingDetails === true;
  }
  return false;
}

/** Validate extracted or structured answers before storing in collected. */
export function validateAnswer(
  component: Component,
  value: unknown,
): { ok: true } | { ok: false; message: string } {
  const accessor = component.accessor ?? component.type;

  if (accessor === "participants") {
    const email = extractParticipantEmail(value);
    if (email && isUploadFileName(email)) {
      return {
        ok: false,
        message:
          "That looks like a filename, not an email. Please enter your email address.",
      };
    }
    if (email && !isValidEmail(email)) {
      return {
        ok: false,
        message:
          "That doesn't look like a valid email address. Please try again.",
      };
    }
    return { ok: true };
  }

  if (
    accessor === "billingDetails" ||
    accessor === "contactDetails" ||
    accessor === "shippingDetails"
  ) {
    if (typeof value !== "object" || value === null) {
      return { ok: true };
    }

    const party = value as Record<string, unknown>;
    if (isSameAsBillingParty(accessor, party)) {
      return { ok: true };
    }

    const hasPartyFields =
      typeof party.firstName === "string" ||
      typeof party.lastName === "string" ||
      typeof party.email === "string" ||
      typeof party.phoneNumber === "string";

    if (!hasPartyFields) {
      return { ok: true };
    }

    if (typeof party.email === "string" && party.email.trim()) {
      const email = party.email.trim();
      if (isUploadFileName(email)) {
        return {
          ok: false,
          message:
            "That looks like a filename, not an email. Please enter your email address.",
        };
      }
      if (!isValidEmail(email)) {
        return {
          ok: false,
          message:
            "That doesn't look like a valid email address. Please try again.",
        };
      }
    }

    const phone =
      typeof party.phoneNumber === "string" ? party.phoneNumber : "";
    if (!isValidPhone(phone)) {
      return {
        ok: false,
        message: "A phone number is required. Please enter your phone number.",
      };
    }
  }

  return { ok: true };
}

export const PARTY_FORM_FIELD_ERRORS = {
  email: "Enter a valid email address",
  phoneNumber: "Phone number is required",
  firstName: "First name is required",
  lastName: "Last name is required",
} as const;

export function validatePartyFormValues(
  values: Record<string, string>,
  fields: { name: string; required?: boolean }[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = values[field.name] ?? "";
    const trimmed = raw.trim();

    if (field.required && !trimmed) {
      errors[field.name] =
        PARTY_FORM_FIELD_ERRORS[
          field.name as keyof typeof PARTY_FORM_FIELD_ERRORS
        ] ?? `${field.name} is required`;
      continue;
    }

    if (field.name === "email" && trimmed && !isValidEmail(trimmed)) {
      errors[field.name] = PARTY_FORM_FIELD_ERRORS.email;
    }

    if (field.name === "phoneNumber" && !isValidPhone(raw)) {
      errors[field.name] = PARTY_FORM_FIELD_ERRORS.phoneNumber;
    }
  }

  return errors;
}
