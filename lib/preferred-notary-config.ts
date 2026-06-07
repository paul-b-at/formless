import type { ProductSelection } from "./booking-schema";
import type {
  BookingFormSchema,
  Collected,
  Component,
  ProductDefinition,
} from "./form-interpreter";

export const PREFERRED_NOTARY_DEFAULT = "";

export type NotaryOption = {
  id: string;
  label: string;
};

export type PreferredNotaryConfig = {
  component: Component | null;
  /** True when the form exposes a notary picker for the current selection. */
  showPicker: boolean;
  required: boolean;
  options: NotaryOption[];
  defaultValue: string;
};

function readStringArray(props: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = props[key];
    if (Array.isArray(value)) {
      return value.map(String).filter(Boolean);
    }
  }
  return [];
}

function normalizeNotaryOption(entry: unknown): NotaryOption | null {
  if (typeof entry === "string" && entry.trim()) {
    return { id: entry.trim(), label: entry.trim() };
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record._id === "string"
        ? record._id
        : typeof record.value === "string"
          ? record.value
          : "";
  if (!id.trim()) {
    return null;
  }
  const label =
    typeof record.name === "string"
      ? record.name
      : typeof record.label === "string"
        ? record.label
        : typeof record.title === "string"
          ? record.title
          : id;
  return { id: id.trim(), label: label.trim() };
}

export function getNotaryOptionsFromProps(
  props: Record<string, unknown> | undefined,
): NotaryOption[] {
  if (!props) {
    return [];
  }

  const rawLists = [
    props.notaries,
    props.options,
    props._notaries,
    props.notaryOptions,
  ];

  const options: NotaryOption[] = [];
  const seen = new Set<string>();

  for (const raw of rawLists) {
    if (!Array.isArray(raw)) {
      continue;
    }
    for (const entry of raw) {
      const option = normalizeNotaryOption(entry);
      if (!option || seen.has(option.id)) {
        continue;
      }
      seen.add(option.id);
      options.push(option);
    }
  }

  return options;
}

function matchesCountryFilter(
  props: Record<string, unknown>,
  destinationCountry: string | undefined,
): boolean {
  const countries = readStringArray(props, [
    "countries",
    "countryCodes",
    "destinationCountries",
  ]);
  if (countries.length === 0) {
    return true;
  }
  if (!destinationCountry) {
    return false;
  }
  return countries.map((code) => code.toUpperCase()).includes(destinationCountry);
}

function productIdsFromCollected(
  products: ProductSelection[] | undefined,
): string[] {
  return (products ?? []).map((product) => product.id);
}

function matchesProductFilter(
  props: Record<string, unknown>,
  products: ProductSelection[] | undefined,
  catalog: ProductDefinition[],
): boolean {
  const productIds = readStringArray(props, ["productIds", "_products", "products"]);
  const tags = readStringArray(props, ["tags", "_tags"]);

  if (productIds.length === 0 && tags.length === 0) {
    return true;
  }

  const selectedIds = new Set(productIdsFromCollected(products));
  if (productIds.length > 0) {
    return productIds.some((id) => selectedIds.has(id));
  }

  if (tags.length > 0) {
    // Tag membership is resolved upstream when products are loaded; without
    // per-product tag metadata we do not block the picker on tag props alone.
    return true;
  }

  return true;
}

export function findPreferredNotaryComponent(
  form: BookingFormSchema,
): Component | null {
  function walk(components: Component[]): Component | null {
    for (const component of components) {
      if (component.type === "condition") {
        const inThen = walk(component.props?.components ?? []);
        if (inThen) {
          return inThen;
        }
        const inElse = walk(component.props?.elseComponents ?? []);
        if (inElse) {
          return inElse;
        }
        continue;
      }
      if (component.type === "preferredNotary") {
        return component;
      }
    }
    return null;
  }

  for (const page of form.pages) {
    const found = walk(page.components);
    if (found) {
      return found;
    }
  }
  return null;
}

export function isPreferredNotaryComponentVisible(
  form: BookingFormSchema,
  collected: Collected,
  component: Component,
): boolean {
  if (component.hidden) {
    return false;
  }
  // preferredNotary is skipped by visibleComponents (not an input step there),
  // but it lives on the summary page once core selections exist.
  const found = findPreferredNotaryComponent(form);
  if (!found || found.id !== component.id) {
    return false;
  }
  return Boolean(
    collected.destinationCountry &&
      (collected.products?.length ?? 0) > 0,
  );
}

export function isPreferredNotaryRelevant(
  component: Component,
  collected: Collected,
  catalog: ProductDefinition[],
): boolean {
  if (component.hidden) {
    return false;
  }

  const props = (component.props ?? {}) as Record<string, unknown>;
  const options = getNotaryOptionsFromProps(props);
  if (options.length === 0) {
    return false;
  }

  if (!matchesCountryFilter(props, collected.destinationCountry)) {
    return false;
  }

  if (!matchesProductFilter(props, collected.products, catalog)) {
    return false;
  }

  return true;
}

export function getPreferredNotaryConfig(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): PreferredNotaryConfig {
  const component = findPreferredNotaryComponent(form);
  if (!component) {
    return {
      component: null,
      showPicker: false,
      required: false,
      options: [],
      defaultValue: PREFERRED_NOTARY_DEFAULT,
    };
  }

  const props = (component.props ?? {}) as Record<string, unknown>;
  const options = getNotaryOptionsFromProps(props);
  const visible = isPreferredNotaryComponentVisible(form, collected, component);
  const relevant =
    visible && isPreferredNotaryRelevant(component, collected, catalog);

  return {
    component,
    showPicker: relevant,
    required: relevant && component.props?.required === true,
    options,
    defaultValue: PREFERRED_NOTARY_DEFAULT,
  };
}

export function isPreferredNotaryResolved(
  config: PreferredNotaryConfig,
  value: string | undefined,
): boolean {
  if (!config.showPicker) {
    return true;
  }

  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    return !config.required;
  }

  return config.options.some((option) => option.id === trimmed);
}

export function resolvePreferredNotaryValue(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): string {
  const config = getPreferredNotaryConfig(form, collected, catalog);
  if (!config.showPicker) {
    return PREFERRED_NOTARY_DEFAULT;
  }

  const trimmed = (collected.preferredNotary ?? "").trim();
  if (!trimmed) {
    return PREFERRED_NOTARY_DEFAULT;
  }

  if (config.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }

  return PREFERRED_NOTARY_DEFAULT;
}

export function pendingPreferredNotaryComponent(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): Component | null {
  const config = getPreferredNotaryConfig(form, collected, catalog);
  if (!config.component || !config.showPicker) {
    return null;
  }
  if (isPreferredNotaryResolved(config, collected.preferredNotary)) {
    return null;
  }
  return config.component;
}

export type PreferredNotaryPathReport = {
  destinationCountry?: string;
  productIds: string[];
  componentFound: boolean;
  optionsCount: number;
  visible: boolean;
  relevant: boolean;
  showPicker: boolean;
  skipReason: string | null;
  payloadValue: string;
  optionLabels: string[];
};

export function explainPreferredNotaryPath(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): PreferredNotaryPathReport {
  const component = findPreferredNotaryComponent(form);
  const destinationCountry = collected.destinationCountry;
  const productIds = productIdsFromCollected(collected.products);
  const payloadValue = resolvePreferredNotaryValue(form, collected, catalog);

  if (!component) {
    return {
      destinationCountry,
      productIds,
      componentFound: false,
      optionsCount: 0,
      visible: false,
      relevant: false,
      showPicker: false,
      skipReason: "booking form has no preferredNotary component",
      payloadValue,
      optionLabels: [],
    };
  }

  const props = (component.props ?? {}) as Record<string, unknown>;
  const options = getNotaryOptionsFromProps(props);
  const visible = isPreferredNotaryComponentVisible(form, collected, component);
  const relevant = isPreferredNotaryRelevant(component, collected, catalog);
  const config = getPreferredNotaryConfig(form, collected, catalog);

  let skipReason: string | null = null;
  if (!visible) {
    skipReason = "preferredNotary component is not visible for this selection";
  } else if (options.length === 0) {
    skipReason =
      "preferredNotary props expose no notary options (notaries/options empty)";
  } else if (!matchesCountryFilter(props, destinationCountry)) {
    const countries = readStringArray(props, [
      "countries",
      "countryCodes",
      "destinationCountries",
    ]);
    skipReason = `country filter ${countries.join(", ")} does not include ${destinationCountry ?? "(unset)"}`;
  } else if (!matchesProductFilter(props, collected.products, catalog)) {
    skipReason = "product filter does not match selected products";
  } else if (config.showPicker && !isPreferredNotaryResolved(config, collected.preferredNotary)) {
    skipReason = null;
  } else if (config.showPicker) {
    skipReason = null;
  }

  return {
    destinationCountry,
    productIds,
    componentFound: true,
    optionsCount: options.length,
    visible,
    relevant,
    showPicker: config.showPicker,
    skipReason: config.showPicker ? null : skipReason,
    payloadValue,
    optionLabels: options.map((option) => option.label),
  };
}

export function formatPreferredNotaryPathLog(
  report: PreferredNotaryPathReport,
): string {
  const country = report.destinationCountry ?? "?";
  const products =
    report.productIds.length > 0 ? report.productIds.join(", ") : "(none)";
  if (report.showPicker) {
    const picked =
      report.payloadValue === PREFERRED_NOTARY_DEFAULT
        ? "No preference"
        : report.payloadValue;
    return `country=${country} products=[${products}] — picker shown (${report.optionsCount} options: ${report.optionLabels.join(" | ")}); payload preferredNotary="${report.payloadValue}" (${picked})`;
  }
  const why = report.skipReason ?? "not applicable";
  return `country=${country} products=[${products}] — picker skipped (${why}); payload preferredNotary="${report.payloadValue}" (default)`;
}

export function preferredNotaryDisplayLabel(
  value: string | undefined,
  config: PreferredNotaryConfig,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "No preference";
  }
  return (
    config.options.find((option) => option.id === trimmed)?.label ?? trimmed
  );
}
