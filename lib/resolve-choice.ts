import "server-only";

import type { EngineState } from "./engine";
import { resolveToOptionValue } from "./answer-resolution";
import {
  getCountryOptions,
  getVisibleProductPickerTags,
  nextUnfilled,
  parseBookingForm,
  type BookingFormSchema,
  type Collected,
  type Component,
  type ProductDefinition,
} from "./form-interpreter";
import { mapDocumentHintToProduct } from "./ocr-product-map";
import { getProductsByTags } from "./notarity";

type ChoiceOption = { label: string; value: string };

function countryOptions(form: BookingFormSchema): ChoiceOption[] {
  return getCountryOptions(form).map((country) => ({
    label: `${country.label} (${country.code})`,
    value: country.code,
  }));
}

function productOptions(catalog: ProductDefinition[]): ChoiceOption[] {
  return catalog
    .filter((product) => product.title.en !== "Auto-added product")
    .map((product) => ({
      label: product.title.en ?? product.id,
      value: product.title.en ?? product.id,
    }));
}

async function loadProductCatalog(
  form: BookingFormSchema,
  collected: Collected,
): Promise<ProductDefinition[]> {
  const tags = getVisibleProductPickerTags(form, collected);
  if (tags.length === 0) {
    return [];
  }
  const raw = await getProductsByTags(tags);
  return raw.map((product) => {
    const record = product as Record<string, unknown>;
    const description =
      typeof record.description === "object" && record.description !== null
        ? {
            en: String(
              (record.description as Record<string, unknown>).en ?? "",
            ).trim(),
          }
        : typeof record.description === "string" && record.description.trim()
          ? { en: record.description.trim() }
          : undefined;
    return {
      id: String(record.id ?? record._id ?? ""),
      title: {
        en:
          typeof record.title === "object" && record.title !== null
            ? String((record.title as Record<string, unknown>).en ?? "")
            : String(record.title ?? record.name ?? record.id ?? ""),
      },
      description:
        description?.en && description.en.length > 0 ? description : undefined,
      apostilleRequired: Boolean(record.apostilleRequired),
      fileUploadRequired: Boolean(record.fileUploadRequired),
    };
  });
}

async function optionsForComponent(
  component: Component,
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[],
): Promise<ChoiceOption[] | undefined> {
  const accessor = component.accessor ?? component.type;

  if (component.type === "countryPicker" || accessor === "destinationCountry") {
    return countryOptions(form);
  }

  if (component.type === "productPicker" || accessor === "products") {
    const needingFiles = (collected.products ?? []).filter((product) => {
      const def = catalog.find((entry) => entry.id === product.id);
      return def?.fileUploadRequired && product.files.length === 0;
    });
    if (needingFiles.length > 0) {
      return undefined;
    }
    return productOptions(catalog);
  }

  if (accessor === "contactDetails" && collected.contactDetails === undefined) {
    return [
      { label: "Same as billing", value: "Same as billing" },
      {
        label: "Enter different contact details",
        value: "Enter different contact details",
      },
    ];
  }

  if (accessor === "hardCopy") {
    return [
      { label: "Yes, send a hard copy", value: "Yes, send a hard copy" },
      { label: "No hard copy needed", value: "No hard copy needed" },
      {
        label: "Express shipping only, no hard copy",
        value: "Express shipping only, no hard copy",
      },
    ];
  }

  if (
    accessor === "shippingDetails" &&
    collected.hardCopy?.hardCopy &&
    !collected.shippingDetails
  ) {
    return [
      { label: "Same as billing address", value: "Same as billing address" },
      {
        label: "Different shipping address",
        value: "Different shipping address",
      },
    ];
  }

  return undefined;
}

/**
 * Deterministic option normalization only — no Gemini.
 * @deprecated Prefer engine extractUserAnswer; kept for callers that pre-normalize messages.
 */
export async function resolveUserMessage(
  state: EngineState,
  userMessage: string,
): Promise<string> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return userMessage;
  }

  const form =
    typeof state.form.id === "string"
      ? state.form
      : parseBookingForm(state.form);
  const collected = (state.collected ?? {}) as Collected;
  const catalog = await loadProductCatalog(form, collected);
  const current = nextUnfilled(form, collected, catalog);
  if (!current) {
    return userMessage;
  }

  const options = await optionsForComponent(
    current,
    form,
    collected,
    catalog,
  );
  if (!options?.length) {
    return userMessage;
  }

  const resolved = resolveToOptionValue(trimmed, options);
  if (resolved) {
    return resolved;
  }

  const accessor = current.accessor ?? current.type;
  if (accessor === "products") {
    const mapped = await mapDocumentHintToProduct({
      productHint: trimmed,
      catalog,
    });
    if (mapped.productTitle) {
      const option = options.find(
        (entry) => entry.value === mapped.productTitle,
      );
      if (option) {
        return option.value;
      }
    }
  }

  return userMessage;
}
