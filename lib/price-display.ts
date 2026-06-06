import type { PriceLineItem } from "./notarity-api";

export type PriceDisplayLine = {
  name: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
};

export type PriceVatSource = "api" | "rate" | "net-only";

export type PriceDisplay = {
  lines: PriceDisplayLine[];
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
  vatSource: PriceVatSource;
  vatNote: string;
};

const TAX_KEYS = [
  "tax",
  "vat",
  "taxAmount",
  "vatAmount",
  "taxNet",
] as const;

const GROSS_KEYS = ["gross", "total", "totalGross", "grossNet"] as const;

const RATE_KEYS = [
  "taxRate",
  "vatRate",
  "vatPercentage",
  "taxPercentage",
] as const;

const TOP_LEVEL_TAX_KEYS = [
  "totalTax",
  "vatTotal",
  "taxTotal",
  "totalVat",
] as const;

const TOP_LEVEL_GROSS_KEYS = [
  "grandTotal",
  "totalGross",
  "grossTotal",
] as const;

function firstNumber(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function normalizeRate(rate: number): number {
  if (rate > 1) {
    return rate / 100;
  }
  return rate;
}

function itemHasTaxFields(item: PriceLineItem): boolean {
  const raw = item as PriceLineItem & Record<string, unknown>;
  return (
    TAX_KEYS.some((key) => typeof raw[key] === "number") ||
    GROSS_KEYS.some((key) => typeof raw[key] === "number") ||
    RATE_KEYS.some((key) => typeof raw[key] === "number")
  );
}

function readLineTaxCents(
  item: PriceLineItem,
  rate?: number,
): { taxCents: number; grossCents: number; usedRate: boolean } {
  const raw = item as PriceLineItem & Record<string, unknown>;
  const explicitTax = firstNumber(raw, TAX_KEYS);
  if (explicitTax !== undefined) {
    const gross = firstNumber(raw, GROSS_KEYS) ?? item.net + explicitTax;
    return { taxCents: Math.max(0, explicitTax), grossCents: gross, usedRate: false };
  }

  const grossField = firstNumber(raw, GROSS_KEYS);
  if (grossField !== undefined) {
    return {
      taxCents: Math.max(0, grossField - item.net),
      grossCents: grossField,
      usedRate: false,
    };
  }

  const lineRate = RATE_KEYS.map((key) => raw[key]).find(
    (value) => typeof value === "number",
  ) as number | undefined;
  const effectiveRate =
    lineRate !== undefined ? normalizeRate(lineRate) : rate;
  if (effectiveRate !== undefined && effectiveRate > 0) {
    const taxCents = Math.round(item.net * effectiveRate);
    return {
      taxCents,
      grossCents: item.net + taxCents,
      usedRate: true,
    };
  }

  return { taxCents: 0, grossCents: item.net, usedRate: false };
}

/** Display-only breakdown — confirmedPrice still uses net sum from the API. */
export function buildPriceDisplay(lineItems: PriceLineItem[]): PriceDisplay {
  const responseRate = lineItems
    .map((item) => {
      const raw = item as PriceLineItem & Record<string, unknown>;
      const rate = RATE_KEYS.map((key) => raw[key]).find(
        (value) => typeof value === "number",
      ) as number | undefined;
      return rate !== undefined ? normalizeRate(rate) : undefined;
    })
    .find((rate) => rate !== undefined && rate > 0);

  const lines = lineItems.map((item) => {
    const { taxCents, grossCents } = readLineTaxCents(item, responseRate);
    return {
      name: item.name,
      netCents: item.net,
      taxCents,
      grossCents,
    };
  });

  const netTotalCents = lines.reduce((sum, line) => sum + line.netCents, 0);
  let taxTotalCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  let grossTotalCents = lines.reduce((sum, line) => sum + line.grossCents, 0);

  const hasPerLineTax = lineItems.some(itemHasTaxFields);
  let vatSource: PriceVatSource = "net-only";
  let vatNote =
    "Staging /price returns net-only line items (no tax, gross, or rate fields). VAT shown as €0.00; total incl. VAT equals net.";

  if (hasPerLineTax) {
    vatSource = responseRate !== undefined ? "rate" : "api";
    vatNote =
      vatSource === "rate"
        ? "VAT computed from rate fields in the /price response."
        : "VAT read from tax/gross fields in the /price response.";
  } else if (responseRate !== undefined && responseRate > 0) {
    vatSource = "rate";
    taxTotalCents = Math.round(netTotalCents * responseRate);
    grossTotalCents = netTotalCents + taxTotalCents;
    vatNote = `VAT computed from /price rate (${(responseRate * 100).toFixed(0)}%).`;
  }

  return {
    lines,
    netTotalCents,
    taxTotalCents,
    grossTotalCents,
    vatSource,
    vatNote,
  };
}

export function centsToEuros(cents: number): number {
  return cents / 100;
}
