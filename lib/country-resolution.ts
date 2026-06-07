import {
  getCountryOptions,
  isDestinationCountrySupported,
  isValidIsoCountryCodeForDisplay,
  type BookingFormSchema,
  type CountryOption,
} from "./form-interpreter";

const COUNTRY_NAME_LOCALES = ["en", "de", "es", "fr"] as const;

/** Historical ISO codes that share modern display names — exclude from name recognition. */
const DEPRECATED_REGION_CODES = new Set([
  "DD",
  "SU",
  "CS",
  "YU",
  "TP",
  "ZR",
]);

export type DestinationCountryResolution =
  | { status: "resolved"; code: string }
  | {
      status: "unsupported";
      code: string;
      name: string;
    }
  | { status: "unmatched" };

/** Trim, lowercase, strip diacritics for stable country-name matching. */
export function normalizeCountryMatchKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function countryFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return "";
  }
  const points = [...normalized].map(
    (char) => 0x1f1e6 + char.charCodeAt(0) - 65,
  );
  return String.fromCodePoint(...points);
}

function displayNamesForCode(code: string): string[] {
  const names = new Set<string>();
  for (const locale of COUNTRY_NAME_LOCALES) {
    try {
      const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
      if (name?.trim()) {
        names.add(name.trim());
      }
    } catch {
      // Skip locales the runtime does not support.
    }
  }
  return [...names];
}

type CountryCandidate = {
  code: string;
  keys: string[];
};

function buildSupportedCandidates(form: BookingFormSchema): CountryCandidate[] {
  return getCountryOptions(form).map(({ code }) => {
    const keys = new Set<string>([
      code,
      ...displayNamesForCode(code),
    ]);
    return {
      code,
      keys: [...keys].map(normalizeCountryMatchKey).filter(Boolean),
    };
  });
}

function supportedCountryCodes(form: BookingFormSchema): Set<string> {
  return new Set(getCountryOptions(form).map((option) => option.code));
}

function allRecognizableCountryCodes(): string[] {
  const codes: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      if (
        !DEPRECATED_REGION_CODES.has(code) &&
        isValidIsoCountryCodeForDisplay(code)
      ) {
        codes.push(code);
      }
    }
  }
  return codes;
}

let recognizableCodesCache: string[] | null = null;

function recognizableCountryCodes(): string[] {
  if (!recognizableCodesCache) {
    recognizableCodesCache = allRecognizableCountryCodes();
  }
  return recognizableCodesCache;
}

function buildAllCountryCandidates(): CountryCandidate[] {
  return recognizableCountryCodes().map((code) => ({
    code,
    keys: [code, ...displayNamesForCode(code)]
      .map(normalizeCountryMatchKey)
      .filter(Boolean),
  }));
}

function matchCandidates(
  query: string,
  candidates: CountryCandidate[],
  mode: "exact" | "startsWith" | "contains",
): string[] {
  const matched = new Set<string>();

  for (const candidate of candidates) {
    const hit = candidate.keys.some((key) => {
      if (!key) {
        return false;
      }
      switch (mode) {
        case "exact":
          return key === query;
        case "startsWith":
          return (
            query.length >= 3 &&
            (key.startsWith(query) || (query.startsWith(key) && key.length >= 3))
          );
        case "contains":
          return (
            query.length >= 4 &&
            (key.includes(query) || query.includes(key))
          );
      }
    });
    if (hit) {
      matched.add(candidate.code);
    }
  }

  return [...matched];
}

function uniqueMatch(
  query: string,
  candidates: CountryCandidate[],
  modes: Array<"exact" | "startsWith" | "contains">,
): string | null {
  for (const mode of modes) {
    const hits = matchCandidates(query, candidates, mode);
    if (hits.length === 1) {
      return hits[0]!;
    }
    if (hits.length > 1) {
      return null;
    }
  }
  return null;
}

function primaryCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const MAX_INLINE_SUPPORTED_COUNTRIES = 6;

export function formatExplicitSupportedCountriesList(
  options: CountryOption[],
): string {
  if (options.length <= MAX_INLINE_SUPPORTED_COUNTRIES) {
    return options
      .map(
        (country) =>
          `${countryFlag(country.code)} ${country.label} (${country.code})`,
      )
      .join(" and ");
  }

  const preview = options
    .slice(0, 4)
    .map(
      (country) =>
        `${countryFlag(country.code)} ${country.label} (${country.code})`,
    )
    .join(", ");
  return `${preview}, and ${options.length - 4} more — pick from the country list below`;
}

export function formatUnsupportedDestinationCountryMessage(
  form: BookingFormSchema,
  resolution: Extract<DestinationCountryResolution, { status: "unsupported" }>,
): string {
  const supported = getCountryOptions(form);
  const list = formatExplicitSupportedCountriesList(supported);
  return `We currently support ${list}. ${resolution.name} (${resolution.code}) isn't available on this booking form — please choose one of those.`;
}

export function formatUnmatchedDestinationCountryMessage(
  form: BookingFormSchema,
): string {
  const supported = getCountryOptions(form);
  const list = formatExplicitSupportedCountriesList(supported);
  return `I didn't recognise that destination country. Please choose from the list — we currently support ${list}.`;
}

/**
 * Resolve free-text / ISO input to a destination country code for this form.
 * Name matching uses only explicit supported countries (dropdown/banner list).
 */
export function resolveDestinationCountryAnswer(
  message: string,
  form: BookingFormSchema,
): DestinationCountryResolution {
  const trimmed = message.trim();
  if (!trimmed) {
    return { status: "unmatched" };
  }

  const fromLabel = trimmed.match(/\(([A-Z]{2})\)\s*$/i);
  if (fromLabel?.[1]) {
    const code = fromLabel[1].toUpperCase();
    if (isDestinationCountrySupported(form, code)) {
      return { status: "resolved", code };
    }
    if (isValidIsoCountryCodeForDisplay(code)) {
      return {
        status: "unsupported",
        code,
        name: primaryCountryName(code),
      };
    }
    return { status: "unmatched" };
  }

  if (/^[A-Z]{2}$/i.test(trimmed)) {
    const code = trimmed.toUpperCase();
    if (isDestinationCountrySupported(form, code)) {
      return { status: "resolved", code };
    }
    if (isValidIsoCountryCodeForDisplay(code)) {
      return {
        status: "unsupported",
        code,
        name: primaryCountryName(code),
      };
    }
    return { status: "unmatched" };
  }

  const query = normalizeCountryMatchKey(trimmed);
  const supportedCandidates = buildSupportedCandidates(form);

  const supportedCode = uniqueMatch(query, supportedCandidates, [
    "exact",
    "startsWith",
    "contains",
  ]);
  if (supportedCode) {
    return { status: "resolved", code: supportedCode };
  }

  if (matchCandidates(query, supportedCandidates, "exact").length > 1) {
    return { status: "unmatched" };
  }
  if (matchCandidates(query, supportedCandidates, "startsWith").length > 1) {
    return { status: "unmatched" };
  }
  if (matchCandidates(query, supportedCandidates, "contains").length > 1) {
    return { status: "unmatched" };
  }

  const supportedCodes = supportedCountryCodes(form);
  const allCandidates = buildAllCountryCandidates();
  const recognizedHits = matchCandidates(query, allCandidates, "exact");

  if (recognizedHits.length > 1) {
    return { status: "unmatched" };
  }

  const recognizedCode = recognizedHits[0];

  if (recognizedCode && !supportedCodes.has(recognizedCode)) {
    return {
      status: "unsupported",
      code: recognizedCode,
      name: primaryCountryName(recognizedCode),
    };
  }

  if (recognizedCode && isDestinationCountrySupported(form, recognizedCode)) {
    return { status: "resolved", code: recognizedCode };
  }

  return { status: "unmatched" };
}

/** Back-compat: ISO code when resolved, otherwise null. */
export function resolveDestinationCountryInput(
  message: string,
  form: BookingFormSchema,
): string | null {
  const resolution = resolveDestinationCountryAnswer(message, form);
  return resolution.status === "resolved" ? resolution.code : null;
}
