/** ISO-3166 alpha-2 → flag emoji via regional indicator symbols. */
export function countryFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return "";
  }

  const points = [...normalized].map(
    (char) => 0x1f1e6 + char.charCodeAt(0) - 65,
  );
  return String.fromCodePoint(...points);
}

export function countryLabelWithFlag(code: string, label?: string): string {
  const flag = countryFlag(code);
  const name = label?.trim() || code;
  return flag ? `${flag} ${name}` : name;
}

/** Pull a 2-letter ISO code from quick-reply value/label text. */
export function extractCountryCodeFromOption(
  value: string,
  label?: string,
): string | null {
  const fromParens = value.match(/\(([A-Z]{2})\)\s*$/i);
  if (fromParens) {
    return fromParens[1]!.toUpperCase();
  }

  if (/^[A-Z]{2}$/i.test(value.trim())) {
    return value.trim().toUpperCase();
  }

  const labelParens = label?.match(/\(([A-Z]{2})\)/i);
  if (labelParens) {
    return labelParens[1]!.toUpperCase();
  }

  return null;
}
