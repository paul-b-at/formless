import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod";

const EmailSchema = z.string().email();

const PHONE_FALLBACK = /^\+?[0-9 ()\-]{7,}$/;

export const PARTY_FIELD_ERRORS = {
  email: "Enter a valid email address",
  phoneNumber: "Enter a valid phone number",
  firstName: "First name is required",
  lastName: "Last name is required",
  companyName: "Company name is required",
  address: "Address is required",
  zipCode: "ZIP / postal code is required",
  city: "City is required",
  countryCode: "Country code is required",
} as const;

export function isBusinessBillingSelected(
  values: Record<string, string>,
): boolean {
  const raw = values.business ?? "";
  return raw === "true" || raw.toLowerCase() === "true";
}

function isBusinessFieldVisible(
  field: { name: string },
  values: Record<string, string>,
): boolean {
  if (field.name === "companyName" || field.name === "vat") {
    return isBusinessBillingSelected(values);
  }
  return true;
}

export function isValidPartyEmail(value: string): boolean {
  return EmailSchema.safeParse(value.trim()).success;
}

export function isValidPartyPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    if (isValidPhoneNumber(trimmed)) {
      return true;
    }
  } catch {
    // Fall through to regex.
  }

  const digits = trimmed.replace(/\D/g, "");
  return PHONE_FALLBACK.test(trimmed) && digits.length >= 7;
}

export function validatePartyFormFields(
  values: Record<string, string>,
  fields: { name: string; required?: boolean; label?: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!isBusinessFieldVisible(field, values)) {
      continue;
    }

    const raw = values[field.name] ?? "";
    const trimmed = raw.trim();

    if (
      (field.required || (field.name === "companyName" && isBusinessBillingSelected(values))) &&
      !trimmed
    ) {
      errors[field.name] =
        PARTY_FIELD_ERRORS[field.name as keyof typeof PARTY_FIELD_ERRORS] ??
        `${field.label ?? field.name} is required`;
      continue;
    }

    if (field.name === "email") {
      if (!trimmed || !isValidPartyEmail(trimmed)) {
        errors[field.name] = PARTY_FIELD_ERRORS.email;
      }
      continue;
    }

    if (field.name === "phoneNumber") {
      if (!isValidPartyPhone(raw)) {
        errors[field.name] = PARTY_FIELD_ERRORS.phoneNumber;
      }
      continue;
    }

    if (field.name === "countryCode" && trimmed && trimmed.length !== 2) {
      errors[field.name] =
        "Country code must be a 2-letter ISO code (e.g. ES)";
    }
  }

  return errors;
}

export function isPartyFormValid(
  values: Record<string, string>,
  fields: { name: string; required?: boolean; label?: string }[],
): boolean {
  return Object.keys(validatePartyFormFields(values, fields)).length === 0;
}
