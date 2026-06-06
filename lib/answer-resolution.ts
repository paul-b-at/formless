import { isUploadFileName } from "./form-interpreter";
import type { Collected, Component, ProductDefinition } from "./form-interpreter";
import type { LabeledOption } from "./timeslot-format";

export type ChoiceOption = LabeledOption;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Exact match against a schema option value or label (quick-reply taps). */
export function exactOptionValue(
  message: string,
  options: ChoiceOption[],
): string | null {
  const normalized = normalizeText(message);
  for (const option of options) {
    if (normalized === normalizeText(option.value)) {
      return option.value;
    }
    if (normalized === normalizeText(option.label)) {
      return option.value;
    }
  }
  return null;
}

/** Fuzzy match for lightly paraphrased typed answers (e.g. "spain" → Spain option). */
export function fuzzyOptionValue(
  message: string,
  options: ChoiceOption[],
): string | null {
  const normalized = normalizeText(message);
  for (const option of options) {
    const label = normalizeText(option.label);
    const value = normalizeText(option.value);
    if (
      label.includes(normalized) ||
      normalized.includes(label) ||
      value.includes(normalized) ||
      normalized.includes(value)
    ) {
      return option.value;
    }
  }
  return null;
}

export function resolveToOptionValue(
  message: string,
  options: ChoiceOption[],
): string | null {
  return exactOptionValue(message, options) ?? fuzzyOptionValue(message, options);
}

/** True when fallback/deterministic extraction produced a storable answer. */
export function isResolvedExtraction(
  component: Component,
  message: string,
  value: unknown,
  catalog: ProductDefinition[],
  availableTimeslots: { id: string; startTime: string }[],
): boolean {
  const accessor = component.accessor ?? component.type;
  const trimmed = message.trim();

  if (accessor === "destinationCountry") {
    return typeof value === "string" && /^[A-Z]{2}$/.test(value);
  }

  if (accessor === "products") {
    if (typeof value === "object" && value !== null) {
      if ("files" in value) {
        const files = (value as { files?: string[] }).files;
        return Array.isArray(files) && files.length > 0;
      }
      if ("id" in value && typeof (value as { id: string }).id === "string") {
        return catalog.some((product) => product.id === (value as { id: string }).id);
      }
    }
    if (typeof value === "string") {
      if (isUploadFileName(value)) {
        return true;
      }
      return catalog.some(
        (product) =>
          product.id === value ||
          product.title.en?.toLowerCase() === value.toLowerCase(),
      );
    }
    return false;
  }

  if (accessor === "timeslots") {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }
    const slotId = String(value[0]);
    return availableTimeslots.some((slot) => slot.id === slotId);
  }

  if (accessor === "hardCopy") {
    return (
      typeof value === "object" &&
      value !== null &&
      "hardCopy" in value &&
      typeof (value as { hardCopy: boolean }).hardCopy === "boolean"
    );
  }

  if (accessor === "contactDetails" || accessor === "shippingDetails") {
    return typeof value === "object" && value !== null;
  }

  if (accessor === "participants") {
    const rows = value as { email?: string }[] | undefined;
    return Array.isArray(rows) && rows.length > 0 && typeof rows[0]?.email === "string";
  }

  if (typeof value === "string" && value === trimmed) {
    return false;
  }

  return value !== undefined && value !== null && value !== "";
}
