import type { FormField } from "./engine";
import type { OcrParty } from "./ocr-types";

const OCR_PARTY_TO_FORM: Record<string, keyof OcrParty> = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  phoneNumber: "phoneNumber",
  address: "address",
  zipCode: "zipCode",
  city: "city",
  stateProvince: "stateProvince",
  countryCode: "countryCode",
  companyName: "companyName",
};

function ocrPartyValue(party: OcrParty, formField: string): string | undefined {
  const ocrKey = OCR_PARTY_TO_FORM[formField];
  if (!ocrKey) {
    return undefined;
  }
  const raw = party[ocrKey];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Map OCR `extracted.party` onto party form defaults — only fields OCR actually returned. */
export function buildPartyPrefillDefaults(
  party: OcrParty | undefined,
  fields: Pick<FormField, "name">[],
): Record<string, string> {
  if (!party) {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const field of fields) {
    const value = ocrPartyValue(party, field.name);
    if (value) {
      defaults[field.name] = value;
    }
  }
  return defaults;
}

export function ocrSuggestedFieldNames(
  defaults: Record<string, string>,
): string[] {
  return Object.keys(defaults);
}

export type PartyFormPrefill = {
  defaults: Record<string, string>;
  suggestedFields: string[];
  suggestedFieldLabels: Record<string, string>;
};

const REMEMBERED_EMAIL_LABEL = "Suggested";
const OCR_FIELD_LABEL = "From your document";

/** Merge OCR party hints with the user's first-entered email suggestion. */
export function buildPartyFormPrefill(
  ocrParty: OcrParty | undefined,
  rememberedEmail: string | null | undefined,
  fields: Pick<FormField, "name">[],
): PartyFormPrefill {
  const ocrDefaults = buildPartyPrefillDefaults(ocrParty, fields);
  const defaults = { ...ocrDefaults };
  const suggestedFields = new Set(ocrSuggestedFieldNames(ocrDefaults));
  const suggestedFieldLabels: Record<string, string> = {};

  for (const field of suggestedFields) {
    suggestedFieldLabels[field] = OCR_FIELD_LABEL;
  }

  const hasEmailField = fields.some((field) => field.name === "email");
  if (rememberedEmail && hasEmailField) {
    defaults.email = rememberedEmail;
    suggestedFields.add("email");
    suggestedFieldLabels.email = REMEMBERED_EMAIL_LABEL;
  }

  return {
    defaults,
    suggestedFields: [...suggestedFields],
    suggestedFieldLabels,
  };
}

export function primaryParticipantEmailSuggestion(args: {
  rememberedEmail: string | null | undefined;
  ocrParty: OcrParty | undefined;
}): { value: string; label: string } | undefined {
  if (args.rememberedEmail) {
    return { value: args.rememberedEmail, label: REMEMBERED_EMAIL_LABEL };
  }
  const email = args.ocrParty?.email?.trim();
  if (email) {
    return { value: email, label: OCR_FIELD_LABEL };
  }
  return undefined;
}

/** Human-readable mapping lines for debug / replay scripts. */
export function describePartyPrefillMapping(
  party: OcrParty | undefined,
  fields: Pick<FormField, "name">[],
): string[] {
  const defaults = buildPartyPrefillDefaults(party, fields);
  return Object.entries(defaults).map(([formField, value]) => {
    const ocrKey = OCR_PARTY_TO_FORM[formField] ?? formField;
    return `extracted.party.${ocrKey} → ${formField}: ${value}`;
  });
}
