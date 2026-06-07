import { normalizeCountryMatchKey } from "@/lib/country-resolution";
import type { CountryOption } from "@/lib/form-interpreter";

const MAX_OCR_COUNTRY_SUGGESTIONS = 3;

function labelSimilarityScore(label: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  const normalized = normalizeCountryMatchKey(label);
  if (normalized === needle) {
    return 100;
  }
  if (normalized.startsWith(needle) || needle.startsWith(normalized)) {
    return 50;
  }
  if (normalized.includes(needle) || needle.includes(normalized)) {
    return 25;
  }
  return 0;
}

/** Top supported countries for OCR confirm — detected country first when supported, then nearest names. */
export function rankOcrCountrySuggestions(
  supported: CountryOption[],
  detectedCode?: string | null,
  detectedLabel?: string | null,
): CountryOption[] {
  if (supported.length === 0) {
    return [];
  }

  const byCode = new Map(supported.map((country) => [country.code, country]));
  const normalizedDetected = detectedCode?.trim().toUpperCase();
  const needle = normalizeCountryMatchKey(
    detectedLabel?.trim() || normalizedDetected || "",
  );

  const ranked: CountryOption[] = [];
  const used = new Set<string>();

  if (normalizedDetected && byCode.has(normalizedDetected)) {
    ranked.push(byCode.get(normalizedDetected)!);
    used.add(normalizedDetected);
  }

  const remaining = supported
    .filter((country) => !used.has(country.code))
    .map((country) => ({
      country,
      score: labelSimilarityScore(country.label, needle),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.country.label.localeCompare(b.country.label),
    );

  for (const { country } of remaining) {
    if (ranked.length >= MAX_OCR_COUNTRY_SUGGESTIONS) {
      break;
    }
    ranked.push(country);
    used.add(country.code);
  }

  return ranked.slice(0, MAX_OCR_COUNTRY_SUGGESTIONS);
}
