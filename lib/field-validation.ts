import { z } from "zod";

import { isUploadFileName, type Component } from "./form-interpreter";
import { getNotaryOptionsFromProps } from "./preferred-notary-config";

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

function extractParticipantEmails(value: unknown): string[] {
  if (Array.isArray(value)) {
    const emails: string[] = [];
    for (const entry of value) {
      if (entry && typeof entry === "object" && "email" in entry) {
        const email = (entry as { email: unknown }).email;
        if (typeof email === "string" && email.trim()) {
          emails.push(email.trim());
        }
      }
    }
    return emails;
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
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
    const emails = extractParticipantEmails(value);
    if (emails.length === 0) {
      return { ok: true };
    }
    for (const email of emails) {
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
    const seen = new Set<string>();
    for (const email of emails) {
      const key = email.toLowerCase();
      if (seen.has(key)) {
        return {
          ok: false,
          message: "Each participant needs a unique email address.",
        };
      }
      seen.add(key);
    }
    return { ok: true };
  }

  if (accessor === "preferredNotary") {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      return { ok: true };
    }
    const options = getNotaryOptionsFromProps(
      (component.props ?? {}) as Record<string, unknown>,
    );
    if (options.some((option) => option.id === trimmed)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: "Please pick a notary from the list or choose No preference.",
    };
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

    const business =
      party.business === true ||
      party.business === "true" ||
      (typeof party.business === "string" &&
        party.business.trim().toLowerCase() === "true");
    if (business) {
      const details = party.businessDetails as { companyName?: string } | undefined;
      const companyName =
        typeof details?.companyName === "string"
          ? details.companyName.trim()
          : typeof party.companyName === "string"
            ? party.companyName.trim()
            : "";
      if (!companyName) {
        return {
          ok: false,
          message: "Company name is required for business billing.",
        };
      }
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
