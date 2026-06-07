import { parsePhoneNumber } from "libphonenumber-js";

import { countryFlag } from "@/components/country-display";

/** Common dial prefixes → ISO-3166 alpha-2 when libphonenumber cannot parse yet. */
const DIAL_CODE_TO_ISO: Record<string, string> = {
  "1": "US",
  "33": "FR",
  "34": "ES",
  "39": "IT",
  "43": "AT",
  "44": "GB",
  "49": "DE",
  "31": "NL",
  "32": "BE",
  "41": "CH",
  "351": "PT",
  "353": "IE",
  "352": "LU",
  "48": "PL",
  "420": "CZ",
  "36": "HU",
  "30": "GR",
  "46": "SE",
  "47": "NO",
  "45": "DK",
  "358": "FI",
};

function isoFromDialPrefix(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  for (let len = 3; len >= 1; len -= 1) {
    const prefix = digits.slice(0, len);
    const iso = DIAL_CODE_TO_ISO[prefix];
    if (iso) {
      return iso;
    }
  }

  return null;
}

/** Derive a flag emoji from the phone number's dial prefix as the user types. */
export function phoneFlagFromNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("+")) {
    try {
      const parsed = parsePhoneNumber(trimmed);
      if (parsed?.country) {
        return countryFlag(parsed.country);
      }
    } catch {
      // Incomplete number while typing — fall through to dial map.
    }

    const iso = isoFromDialPrefix(trimmed.slice(1));
    if (iso) {
      return countryFlag(iso);
    }
  }

  return "";
}

/** Neutral placeholder when a dial prefix is present but not yet recognized. */
export function phoneFlagOrPlaceholder(value: string): string {
  const flag = phoneFlagFromNumber(value);
  if (flag) {
    return flag;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("+") && trimmed.length > 1) {
    return "🌐";
  }

  return "";
}
