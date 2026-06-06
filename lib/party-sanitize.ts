import type { Collected } from "./form-interpreter";

const OPTIONAL_PARTY_STRINGS = [
  "address",
  "zipCode",
  "city",
  "stateProvince",
  "countryCode",
] as const;

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Strip empty optional strings so zod .optional() fields are truly omitted. */
export function sanitizeParty<T extends Record<string, unknown>>(
  party: T,
  options?: { destinationCountry?: string; defaultCountry?: boolean },
): T {
  const next = { ...party } as Record<string, unknown>;

  for (const key of OPTIONAL_PARTY_STRINGS) {
    if (!(key in next)) {
      continue;
    }
    const value = next[key];
    if (typeof value !== "string") {
      continue;
    }
    const cleaned = blankToUndefined(value);
    if (cleaned === undefined) {
      delete next[key];
    } else if (key === "countryCode") {
      next[key] = cleaned.toUpperCase().slice(0, 2);
    } else {
      next[key] = cleaned;
    }
  }

  if (
    options?.defaultCountry &&
    options.destinationCountry &&
    !("countryCode" in next)
  ) {
    next.countryCode = options.destinationCountry;
  }

  return next as T;
}

export function sanitizeCollected(collected: Collected): Collected {
  const destinationCountry = collected.destinationCountry;
  const next: Collected = { ...collected };

  if (next.billingDetails) {
    next.billingDetails = sanitizeParty(
      next.billingDetails as Record<string, unknown>,
      { destinationCountry, defaultCountry: true },
    ) as Collected["billingDetails"];
  }

  if (next.contactDetails) {
    next.contactDetails = sanitizeParty(
      next.contactDetails as Record<string, unknown>,
      {
        destinationCountry,
        defaultCountry: !next.contactDetails.contactDetailsSameAsBillingDetails,
      },
    ) as Collected["contactDetails"];
  }

  if (next.shippingDetails) {
    next.shippingDetails = sanitizeParty(
      next.shippingDetails as Record<string, unknown>,
      {
        destinationCountry,
        defaultCountry:
          !next.shippingDetails.shippingDetailsSameAsBillingDetails,
      },
    ) as Collected["shippingDetails"];
  }

  return next;
}

/** Sanitize party fields on a raw appointment payload before zod parse. */
export function sanitizeAppointmentPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const obj = raw as Record<string, unknown>;
  const destinationCountry =
    typeof obj.destinationCountry === "string"
      ? obj.destinationCountry
      : undefined;

  const contact = obj.contactDetails as
    | { contactDetailsSameAsBillingDetails?: boolean }
    | undefined;
  const shipping = obj.shippingDetails as
    | { shippingDetailsSameAsBillingDetails?: boolean }
    | undefined;

  return {
    ...obj,
    billingDetails:
      obj.billingDetails && typeof obj.billingDetails === "object"
        ? sanitizeParty(obj.billingDetails as Record<string, unknown>, {
            destinationCountry,
            defaultCountry: true,
          })
        : obj.billingDetails,
    contactDetails:
      obj.contactDetails && typeof obj.contactDetails === "object"
        ? sanitizeParty(obj.contactDetails as Record<string, unknown>, {
            destinationCountry,
            defaultCountry: !contact?.contactDetailsSameAsBillingDetails,
          })
        : obj.contactDetails,
    shippingDetails:
      obj.shippingDetails && typeof obj.shippingDetails === "object"
        ? sanitizeParty(obj.shippingDetails as Record<string, unknown>, {
            destinationCountry,
            defaultCountry: !shipping?.shippingDetailsSameAsBillingDetails,
          })
        : obj.shippingDetails,
  };
}
