import { z } from "zod";

import type { AppointmentRequest, ProductSelection } from "./booking-schema";
import {
  getParticipantSetup,
  isParticipantsFilled,
} from "./participant-config";
import { PREFERRED_NOTARY_DEFAULT } from "./preferred-notary-config";

// --- Schema types (from GET /booking-form/slug) ---

export const LocalizedTextSchema = z.record(z.string());
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const ConditionOperatorSchema = z.enum([
  "ISDEFINED",
  "INCLUDES",
  "EQUAL",
  "INTERSECTS",
  "ISTRUE",
  "AND",
  "OR",
  "NOT",
]);

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const ConditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.object({
      condition: z.enum([
        "ISDEFINED",
        "INCLUDES",
        "EQUAL",
        "INTERSECTS",
        "ISTRUE",
      ]),
      compare: z.string(),
      value: z.string().optional(),
    }),
    z.object({
      condition: z.enum(["AND", "OR", "NOT"]),
      conditions: z.array(ConditionExprSchema).min(1),
    }),
  ]),
);

export type LeafCondition = {
  condition: "ISDEFINED" | "INCLUDES" | "EQUAL" | "INTERSECTS" | "ISTRUE";
  compare: string;
  value?: string;
};

export type ConditionExpr =
  | LeafCondition
  | {
      condition: "AND" | "OR" | "NOT";
      conditions: ConditionExpr[];
    };

function isLeafCondition(condition: ConditionExpr): condition is LeafCondition {
  return (
    condition.condition !== "AND" &&
    condition.condition !== "OR" &&
    condition.condition !== "NOT"
  );
}

export const ComponentSchema: z.ZodType<Component> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    hidden: z.boolean().optional(),
    accessor: z.string().optional(),
    label: LocalizedTextSchema.optional(),
    options: z.array(z.unknown()).optional(),
    defaultValue: z.string().optional(),
    props: z
      .object({
        condition: ConditionOperatorSchema.optional(),
        compare: z.string().optional(),
        value: z.string().optional(),
        components: z.array(ComponentSchema).optional(),
        elseComponents: z.array(ComponentSchema).optional(),
        tags: z.array(z.string()).optional(),
        timeslotLabel: z.string().optional(),
        _product: z.string().optional(),
        hideHardCopy: z.boolean().optional(),
        hideExpressShipping: z.boolean().optional(),
        hidePricingOverview: z.boolean().optional(),
        hideBillingDetails: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  }),
);

export type Component = {
  id: string;
  type: string;
  hidden?: boolean;
  accessor?: string;
  label?: LocalizedText;
  options?: unknown[];
  defaultValue?: string;
  props?: {
    condition?: ConditionOperator;
    compare?: string;
    value?: string;
    components?: Component[];
    elseComponents?: Component[];
    tags?: string[];
    timeslotLabel?: string;
    _product?: string;
    hideHardCopy?: boolean;
    hideExpressShipping?: boolean;
    hidePricingOverview?: boolean;
    hideBillingDetails?: boolean;
    [key: string]: unknown;
  };
};

export const PageSchema = z.object({
  title: LocalizedTextSchema.optional(),
  slug: z.string().optional(),
  components: z.array(ComponentSchema),
});

export type Page = z.infer<typeof PageSchema>;

export const BookingFormSchemaSchema = z
  .object({
    id: z.string(),
    slug: z.string().optional(),
    _company: z.string().optional(),
    pages: z.array(PageSchema),
    options: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type BookingFormSchema = z.infer<typeof BookingFormSchemaSchema>;

export type ProductDefinition = {
  id: string;
  title: Record<string, string>;
  description?: Record<string, string>;
  apostilleRequired?: boolean;
  showApostille?: boolean;
  fileUploadRequired?: boolean;
  showFileUpload?: boolean;
  showProofOfRepresentation?: boolean;
  proofOfRepresentationRequired?: boolean;
  proofOfRepresentationCheckedByDefault?: boolean;
};

export type Collected = Partial<AppointmentRequest> & {
  /** UI/engine meta — stripped before AppointmentRequest.parse */
  termsAccepted?: boolean;
  participantsExpectMore?: boolean;
  participantsFinalized?: boolean;
};

const SKIP_TYPES = new Set(["condition", "summary", "singleProduct", "preferredNotary"]);

const INPUT_TYPES = new Set([
  "countryPicker",
  "productPicker",
  "participants",
  "timeSlots",
  "billingDetails",
  "contactDetails",
  "hardCopy",
  "shippingDetails",
  "confirmTC",
  "newsletter",
]);

export function parseBookingForm(raw: unknown): BookingFormSchema {
  return BookingFormSchemaSchema.parse(raw);
}

export function getAccessor(component: Component): string | null {
  if (component.accessor) {
    return component.accessor;
  }
  if (component.type === "shippingDetails") {
    return "shippingDetails";
  }
  if (component.type === "confirmTC") {
    return "confirmTC";
  }
  if (component.type === "preferredNotary") {
    return "preferredNotary";
  }
  return null;
}

export function isInputComponent(component: Component): boolean {
  if (component.hidden) {
    return false;
  }
  if (SKIP_TYPES.has(component.type)) {
    return false;
  }
  if (INPUT_TYPES.has(component.type)) {
    return true;
  }
  return getAccessor(component) !== null;
}

function getByPath(collected: Collected, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = collected;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (part === "id") {
        return current
          .map((item) =>
            typeof item === "object" && item !== null && "id" in item
              ? (item as { id: string }).id
              : undefined,
          )
          .filter((id): id is string => typeof id === "string");
      }
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

function parseConditionValue(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function arraysIntersect(a: unknown[], b: unknown[]): boolean {
  const setB = new Set(b.map(String));
  return a.some((item) => setB.has(String(item)));
}

export function evaluateCondition(
  condition: ConditionExpr | undefined,
  collected: Collected,
): boolean {
  if (!condition) {
    return true;
  }

  if (condition.condition === "AND" || condition.condition === "OR") {
    const results = condition.conditions.map((child) =>
      evaluateCondition(child, collected),
    );
    if (condition.condition === "AND") {
      return results.every(Boolean);
    }
    return results.some(Boolean);
  }

  if (condition.condition === "NOT") {
    return !condition.conditions.every((child) =>
      evaluateCondition(child, collected),
    );
  }

  if (!isLeafCondition(condition)) {
    return false;
  }

  const actual = getByPath(collected, condition.compare);
  const expected = parseConditionValue(condition.value);

  switch (condition.condition) {
    case "ISDEFINED":
      return actual !== undefined && actual !== null && actual !== "";
    case "INCLUDES": {
      const haystack = asArray(expected);
      return haystack.map(String).includes(String(actual));
    }
    case "EQUAL":
      return String(actual) === String(expected);
    case "INTERSECTS": {
      const left = asArray(actual);
      const right = asArray(expected);
      return arraysIntersect(left, right);
    }
    case "ISTRUE":
      return actual === true;
    default:
      return false;
  }
}

function collectVisible(
  components: Component[],
  collected: Collected,
  out: Component[],
): void {
  for (const component of components) {
    if (component.hidden) {
      continue;
    }

    if (component.type === "condition") {
      const expr = component.props as ConditionExpr | undefined;
      const branch = evaluateCondition(expr, collected)
        ? (component.props?.components ?? [])
        : (component.props?.elseComponents ?? []);
      collectVisible(branch, collected, out);
      continue;
    }

    if (isInputComponent(component)) {
      out.push(component);
    }
  }
}

export function visibleComponents(
  form: BookingFormSchema,
  collected: Collected,
): Component[] {
  const visible: Component[] = [];
  for (const page of form.pages) {
    collectVisible(page.components, collected, visible);
  }
  return visible;
}

export function getProductDef(
  id: string,
  catalog: ProductDefinition[],
): ProductDefinition | undefined {
  return catalog.find((p) => p.id === id);
}

export function isUploadFileName(value: string): boolean {
  return /\.(pdf|png|jpe?g|webp)$/i.test(value.trim());
}

/** Products in collected that still need an uploaded file. */
export function getProductsNeedingFiles(
  collected: Collected,
  catalog: ProductDefinition[],
): ProductSelection[] {
  return (collected.products ?? []).filter((product) => {
    const def = getProductDef(product.id, catalog);
    return Boolean(def?.fileUploadRequired && product.files.length === 0);
  });
}

export function productDisplayName(
  def: ProductDefinition | undefined,
  productId: string,
): string {
  const title = def?.title.en?.trim();
  if (title && title !== "Auto-added product") {
    return title;
  }
  if (productId === "xK5IkgPX1LTYdWLFzW8X") {
    return "NIE Personal Data";
  }
  return title || productId;
}

function getProductsAcceptingOptionalUpload(
  collected: Collected,
  catalog: ProductDefinition[],
): ProductSelection[] {
  return (collected.products ?? []).filter((product) => {
    const def = getProductDef(product.id, catalog);
    return Boolean(def?.showFileUpload && product.files.length === 0);
  });
}

/** Resolve which product should receive an uploaded filename (scripted/replay only). */
export function resolveFileUploadProductId(
  fileName: string,
  collected: Collected,
  catalog: ProductDefinition[],
  targetProductId?: string,
): string | undefined {
  const needing = getProductsNeedingFiles(collected, catalog);
  const candidates =
    needing.length > 0 ? needing : getProductsAcceptingOptionalUpload(collected, catalog);
  if (candidates.length === 0) {
    return undefined;
  }

  if (
    targetProductId &&
    candidates.some((product) => product.id === targetProductId)
  ) {
    return targetProductId;
  }

  if (candidates.length === 1) {
    return candidates[0]!.id;
  }

  const normalized = fileName.trim();

  if (/personal/i.test(normalized)) {
    const match = candidates.find((product) =>
      productDisplayName(getProductDef(product.id, catalog), product.id)
        .toLowerCase()
        .includes("personal"),
    );
    if (match) {
      return match.id;
    }
  }

  if (/application/i.test(normalized)) {
    const match = candidates.find((product) => {
      const label = productDisplayName(
        getProductDef(product.id, catalog),
        product.id,
      ).toLowerCase();
      return label.includes("application") || label.includes("nie number");
    });
    if (match) {
      return match.id;
    }
  }

  return undefined;
}

/** Reject reusing a file that already belongs to a different product. */
export function validateFileForProductUpload(args: {
  fileName: string;
  targetProductId: string;
  collected: Collected;
  catalog: ProductDefinition[];
  sessionFileOwners: Record<string, string>;
}): { ok: true } | { ok: false; message: string } {
  const normalized = args.fileName.trim();
  const targetDef = getProductDef(args.targetProductId, args.catalog);
  const targetName = productDisplayName(targetDef, args.targetProductId);

  const ownerFromSession = args.sessionFileOwners[normalized];
  if (ownerFromSession && ownerFromSession !== args.targetProductId) {
    const ownerDef = getProductDef(ownerFromSession, args.catalog);
    const ownerName = productDisplayName(ownerDef, ownerFromSession);
    return {
      ok: false,
      message: `That file is already attached to ${ownerName} — upload the ${targetName} document.`,
    };
  }

  for (const product of args.collected.products ?? []) {
    if (
      product.id !== args.targetProductId &&
      product.files.includes(normalized)
    ) {
      const ownerDef = getProductDef(product.id, args.catalog);
      const ownerName = productDisplayName(ownerDef, product.id);
      return {
        ok: false,
        message: `That file is already attached to ${ownerName} — upload the ${targetName} document.`,
      };
    }
  }

  return { ok: true };
}

export function attachFileToProduct(
  collected: Collected,
  productId: string,
  fileName: string,
  catalog: ProductDefinition[],
): Collected {
  const products = [...(collected.products ?? [])];
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) {
    return collected;
  }

  const normalized = fileName.trim();
  if (!normalized) {
    return collected;
  }

  const existing = products[index]!;
  if (existing.files.includes(normalized)) {
    return collected;
  }

  const def = getProductDef(productId, catalog);
  products[index] = {
    ...existing,
    files: [...existing.files, normalized],
    apostille: def?.apostilleRequired ? true : existing.apostille,
  };

  return { ...collected, products };
}

/**
 * Attach session files only to the product that owns each file.
 * Never cross-assign one product's document to a different product.
 */
export function autoAttachSessionFiles(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[],
  sessionFiles: string[],
  sessionFileOwners: Record<string, string> = {},
): Collected {
  if (sessionFiles.length === 0) {
    return collected;
  }

  let next = collected;
  const attached = new Set(
    (collected.products ?? []).flatMap((product) => product.files),
  );

  for (const fileName of sessionFiles) {
    const ownerId = sessionFileOwners[fileName];
    if (!ownerId || attached.has(fileName)) {
      continue;
    }

    const ownerProduct = (next.products ?? []).find(
      (product) => product.id === ownerId,
    );
    const ownerDef = getProductDef(ownerId, catalog);
    const mayAttach =
      ownerProduct &&
      !ownerProduct.files.includes(fileName) &&
      ownerDef &&
      (ownerDef.fileUploadRequired || ownerDef.showFileUpload);

    if (!mayAttach) {
      continue;
    }

    next = attachFileToProduct(next, ownerId, fileName, catalog);
    attached.add(fileName);
  }

  return applyAutoAddRules(form, next);
}

export function findNewlyAttachedFile(
  before: Collected,
  after: Collected,
): string | undefined {
  const beforeFiles = new Set(
    (before.products ?? []).flatMap((product) => product.files),
  );
  for (const product of after.products ?? []) {
    for (const file of product.files) {
      if (!beforeFiles.has(file)) {
        return file;
      }
    }
  }
  return undefined;
}

function isPartyFilled(party: unknown): boolean {
  if (!party || typeof party !== "object") {
    return false;
  }
  const p = party as Record<string, unknown>;
  const baseFilled =
    typeof p.firstName === "string" &&
    p.firstName.length > 0 &&
    typeof p.lastName === "string" &&
    p.lastName.length > 0 &&
    typeof p.email === "string" &&
    p.email.length > 0 &&
    typeof p.phoneNumber === "string" &&
    p.phoneNumber.trim().length > 0;

  if (!baseFilled) {
    return false;
  }

  if (p.business === true) {
    const details = p.businessDetails as { companyName?: string } | undefined;
    const companyName =
      typeof details?.companyName === "string"
        ? details.companyName.trim()
        : typeof p.companyName === "string"
          ? p.companyName.trim()
          : "";
    if (!companyName) {
      return false;
    }
  }

  const addressFilled =
    typeof p.address === "string" &&
    p.address.trim().length > 0 &&
    typeof p.zipCode === "string" &&
    p.zipCode.trim().length > 0 &&
    typeof p.city === "string" &&
    p.city.trim().length > 0 &&
    typeof p.countryCode === "string" &&
    p.countryCode.trim().length === 2;

  return addressFilled;
}

function isProductsFilled(
  collected: Collected,
  visible: Component[],
  catalog: ProductDefinition[],
): boolean {
  const products = collected.products ?? [];
  if (products.length === 0) {
    return false;
  }

  for (const component of visible) {
    if (component.type === "productPicker") {
      const pickerIds = catalog.map((p) => p.id);
      if (pickerIds.length === 0) {
        continue;
      }
      const hasPickerProduct = products.some((p) => pickerIds.includes(p.id));
      if (!hasPickerProduct) {
        return false;
      }
    }
  }

  for (const product of products) {
    const def = getProductDef(product.id, catalog);
    if (!def) {
      continue;
    }
    if (def.apostilleRequired && product.apostille !== true) {
      return false;
    }
    if (def.fileUploadRequired && product.files.length === 0) {
      return false;
    }
  }

  return true;
}

function isComponentFilled(
  component: Component,
  collected: Collected,
  visible: Component[],
  catalog: ProductDefinition[],
): boolean {
  if (component.type === "confirmTC") {
    // T&C acceptance is collected once in the Review summary, not in chat.
    return true;
  }

  const accessor = getAccessor(component);
  if (!accessor) {
    return true;
  }

  switch (accessor) {
    case "destinationCountry":
      return (
        typeof collected.destinationCountry === "string" &&
        collected.destinationCountry.length === 2
      );
    case "products":
      return isProductsFilled(collected, visible, catalog);
    case "participants":
      return isParticipantsFilled(collected, getParticipantSetup(component));
    case "timeslots":
      return (collected.timeslots?.length ?? 0) > 0;
    case "billingDetails":
      return isPartyFilled(collected.billingDetails);
    case "contactDetails": {
      const contact = collected.contactDetails;
      if (contact?.contactDetailsSameAsBillingDetails) {
        return isPartyFilled(collected.billingDetails);
      }
      return isPartyFilled(contact);
    }
    case "hardCopy":
      return (
        collected.hardCopy !== undefined &&
        collected.hardCopy.hardCopy !== undefined
      );
    case "shippingDetails": {
      if (!collected.hardCopy?.hardCopy) {
        return true;
      }
      const shipping = collected.shippingDetails;
      if (!shipping) {
        return false;
      }
      if (shipping.shippingDetailsSameAsBillingDetails) {
        return isPartyFilled(collected.billingDetails);
      }
      return isPartyFilled(shipping);
    }
    case "newsletter":
      // Newsletter opt-in is collected in the Review summary, not in chat.
      return true;
    case "preferredNotary":
      return true;
    default:
      return getByPath(collected, accessor) !== undefined;
  }
}

export function nextUnfilled(
  form: BookingFormSchema,
  collected: Collected,
  catalog: ProductDefinition[] = [],
): Component | null {
  const visible = visibleComponents(form, collected);

  for (const component of visible) {
    if (!isComponentFilled(component, collected, visible, catalog)) {
      return component;
    }
  }

  return null;
}

function defaultProductSelection(
  id: string,
  def?: ProductDefinition,
): ProductSelection {
  return {
    id,
    apostille: def?.apostilleRequired ? true : null,
    userInput: "",
    documentsNotReadyYet: false,
    needHelpDrafting: false,
    proofOfRepresentation: def?.proofOfRepresentationCheckedByDefault
      ? true
      : null,
    files: [],
  };
}

function applyAutoAddRules(
  form: BookingFormSchema,
  collected: Collected,
): Collected {
  const next = { ...collected, products: [...(collected.products ?? [])] };
  const visible = visibleComponents(form, next);

  collectAutoAddProducts(form.pages.flatMap((p) => p.components), collected, next);
  return next;
}

function collectAutoAddProducts(
  components: Component[],
  collected: Collected,
  next: Collected,
): void {
  for (const component of components) {
    if (component.type === "condition") {
      const expr = component.props as ConditionExpr | undefined;
      const branch = evaluateCondition(expr, collected)
        ? (component.props?.components ?? [])
        : (component.props?.elseComponents ?? []);
      collectAutoAddProducts(branch, collected, next);
      continue;
    }

    if (component.type === "singleProduct") {
      const productId = component.props?._product;
      if (productId && !next.products?.some((p) => p.id === productId)) {
        next.products = [
          ...(next.products ?? []),
          defaultProductSelection(productId),
        ];
      }
    }
  }
}

function mergeProduct(
  products: ProductSelection[],
  update: ProductSelection,
): ProductSelection[] {
  const index = products.findIndex((p) => p.id === update.id);
  if (index === -1) {
    return [...products, update];
  }
  const merged = { ...products[index], ...update };
  const copy = [...products];
  copy[index] = merged;
  return copy;
}

export function applyAnswer(
  form: BookingFormSchema,
  collected: Collected,
  component: Component,
  value: unknown,
  catalog: ProductDefinition[] = [],
  targetProductId?: string,
): Collected {
  const accessor = getAccessor(component);
  let next: Collected = { ...collected };

  if (component.type === "confirmTC" || accessor === "confirmTC") {
    next.termsAccepted = Boolean(value);
    return applyAutoAddRules(form, next);
  }

  if (!accessor) {
    return collected;
  }

  switch (accessor) {
    case "destinationCountry":
      next.destinationCountry = String(value);
      break;
    case "products": {
      const products = [...(next.products ?? [])];
      if (Array.isArray(value)) {
        next.products = value as ProductSelection[];
      } else if (typeof value === "object" && value !== null) {
        const raw = value as Partial<ProductSelection> & { id: string };
        const existing = products.find((p) => p.id === raw.id);
        const def = getProductDef(raw.id, catalog);
        const base = existing ?? defaultProductSelection(raw.id, def);
        const mergedFiles =
          raw.files && raw.files.length > 0
            ? [...new Set([...base.files, ...raw.files])]
            : base.files;
        next.products = mergeProduct(products, {
          ...base,
          ...raw,
          files: mergedFiles,
        });
      } else if (typeof value === "string") {
        const trimmed = value.trim();
        if (isUploadFileName(trimmed)) {
          const productId = resolveFileUploadProductId(
            trimmed,
            { ...next, products },
            catalog,
            targetProductId,
          );
          if (productId) {
            next = attachFileToProduct(next, productId, trimmed, catalog);
            break;
          }
        }
        const catalogMatch =
          catalog.find((product) => product.id === trimmed) ??
          catalog.find(
            (product) =>
              product.title.en?.toLowerCase() === trimmed.toLowerCase(),
          );
        if (catalogMatch) {
          next.products = mergeProduct(
            products,
            defaultProductSelection(catalogMatch.id, catalogMatch),
          );
        }
      }
      break;
    }
    case "participants":
      next.participants = value as Collected["participants"];
      break;
    case "timeslots":
      next.timeslots = Array.isArray(value) ? (value as string[]) : [String(value)];
      break;
    case "billingDetails":
      next.billingDetails = value as Collected["billingDetails"];
      break;
    case "contactDetails":
      next.contactDetails = value as Collected["contactDetails"];
      break;
    case "hardCopy":
      next.hardCopy = value as Collected["hardCopy"];
      break;
    case "shippingDetails":
      next.shippingDetails = value as Collected["shippingDetails"];
      break;
    case "newsletter":
      next.newsletter = Boolean(value);
      break;
    case "preferredNotary":
      next.preferredNotary =
        typeof value === "string" ? value.trim() : PREFERRED_NOTARY_DEFAULT;
      break;
    default:
      (next as Record<string, unknown>)[accessor] = value;
  }

  return applyAutoAddRules(form, next);
}

export function getTimeslotLabel(
  form: BookingFormSchema,
  collected: Collected,
): string | null {
  const visible = visibleComponents(form, collected);
  const slot = visible.find((c) => c.type === "timeSlots");
  return slot?.props?.timeslotLabel ?? null;
}

export type CountryOption = { code: string; label: string };

export type DestinationCountryConfig = {
  /** ISO-2 codes named explicitly in destinationCountry conditions. */
  explicitCodes: string[];
  /** When true, any other valid ISO-2 resolves via the form's else branches. */
  allowsOtherCountries: boolean;
};

const GENERIC_DESTINATION_PROBE = "LT";

/** Historical ISO codes that share modern display names — exclude from supported lists. */
const DEPRECATED_REGION_CODES = new Set([
  "DD",
  "SU",
  "CS",
  "YU",
  "TP",
  "ZR",
]);

function countryDisplayNames(): Intl.DisplayNames {
  return new Intl.DisplayNames("en", { type: "region" });
}

export function isValidIsoCountryCodeForDisplay(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) {
    return false;
  }
  const label = countryDisplayNames().of(code);
  return Boolean(label && label !== code);
}

function isValidIsoCountryCode(code: string): boolean {
  return isValidIsoCountryCodeForDisplay(code);
}

/** ISO-2 codes named explicitly in destinationCountry conditions (+ countryPicker options). */
export function getExplicitDestinationCountryCodes(
  form: BookingFormSchema,
): string[] {
  const codes = new Set<string>();

  function walkObject(obj: unknown): void {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const record = obj as Record<string, unknown>;
    if (
      record.compare === "destinationCountry" &&
      typeof record.value === "string"
    ) {
      try {
        const parsed = JSON.parse(record.value) as unknown;
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            codes.add(String(entry).toUpperCase());
          }
        } else {
          codes.add(String(record.value).toUpperCase());
        }
      } catch {
        codes.add(String(record.value).toUpperCase());
      }
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          walkObject(item);
        }
      } else {
        walkObject(value);
      }
    }
  }

  walkObject(form);

  for (const page of form.pages) {
    for (const component of page.components) {
      if (component.type !== "countryPicker" || !component.options) {
        continue;
      }
      for (const option of component.options) {
        if (typeof option === "string" && option.length === 2) {
          codes.add(option.toUpperCase());
        } else if (typeof option === "object" && option !== null) {
          const entry = option as { code?: string; value?: string };
          if (entry.code) {
            codes.add(entry.code.toUpperCase());
          } else if (entry.value?.length === 2) {
            codes.add(entry.value.toUpperCase());
          }
        }
      }
    }
  }

  return [...codes].sort();
}

/** True when non-special ISO countries resolve product/timeslot via else branches. */
export function allowsOtherDestinationCountries(
  form: BookingFormSchema,
): boolean {
  const probe = { destinationCountry: GENERIC_DESTINATION_PROBE };
  return getVisibleProductPickerTags(form, probe).length > 0;
}

export function getDestinationCountryConfig(
  form: BookingFormSchema,
): DestinationCountryConfig {
  return {
    explicitCodes: getExplicitDestinationCountryCodes(form),
    allowsOtherCountries: allowsOtherDestinationCountries(form),
  };
}

export function isDestinationCountrySupported(
  form: BookingFormSchema,
  code: string,
): boolean {
  const normalized = code.trim().toUpperCase();
  if (!isValidIsoCountryCode(normalized)) {
    return false;
  }

  const { explicitCodes, allowsOtherCountries } =
    getDestinationCountryConfig(form);
  if (explicitCodes.includes(normalized)) {
    return true;
  }

  if (!allowsOtherCountries) {
    return false;
  }

  const collected = { destinationCountry: normalized };
  return getVisibleProductPickerTags(form, collected).length > 0;
}

const supportedDestinationCodesCache = new Map<string, string[]>();

/**
 * Every ISO-2 destination country this booking form accepts — single source of truth
 * for engine validation, picker, banner, and name matching.
 * Explicit condition countries (e.g. AT, ES) plus generic-else countries (e.g. LT).
 */
export function getSupportedDestinationCountryCodes(
  form: BookingFormSchema,
): string[] {
  const cacheKey = `${form.id ?? "form"}:${getExplicitDestinationCountryCodes(form).join(",")}:${allowsOtherDestinationCountries(form)}`;
  const cached = supportedDestinationCodesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const codes = new Set(getExplicitDestinationCountryCodes(form));
  const { allowsOtherCountries } = getDestinationCountryConfig(form);

  if (allowsOtherCountries) {
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b);
        if (
          !DEPRECATED_REGION_CODES.has(code) &&
          isDestinationCountrySupported(form, code)
        ) {
          codes.add(code);
        }
      }
    }
  }

  const sorted = [...codes].sort();
  supportedDestinationCodesCache.set(cacheKey, sorted);
  return sorted;
}

export type CountryOptionsArgs = {
  /** Extra ISO-2 codes to include (e.g. OCR inference) when supported by the form. */
  ensureCodes?: string[];
};

/**
 * Country choices for the destination-country step, OCR confirmation, picker, and banner.
 * Derived from getSupportedDestinationCountryCodes (same set the engine accepts).
 */
export function getCountryOptions(
  form: BookingFormSchema,
  args?: CountryOptionsArgs,
): CountryOption[] {
  const display = countryDisplayNames();
  const codes = new Set(getSupportedDestinationCountryCodes(form));

  for (const raw of args?.ensureCodes ?? []) {
    const normalized = raw.trim().toUpperCase();
    if (isDestinationCountrySupported(form, normalized)) {
      codes.add(normalized);
    }
  }

  return [...codes]
    .sort()
    .map((code) => ({ code, label: display.of(code) ?? code }));
}

export {
  formatExplicitSupportedCountriesList,
  formatUnmatchedDestinationCountryMessage,
  formatUnsupportedDestinationCountryMessage,
  normalizeCountryMatchKey,
  resolveDestinationCountryAnswer,
  resolveDestinationCountryInput,
  type DestinationCountryResolution,
} from "./country-resolution";

export function getVisibleProductPickerTags(
  form: BookingFormSchema,
  collected: Collected,
): string[] {
  const visible = visibleComponents(form, collected);
  const tags: string[] = [];
  for (const component of visible) {
    if (component.type === "productPicker" && component.props?.tags) {
      tags.push(...component.props.tags);
    }
  }
  return [...new Set(tags)];
}

export function componentLabel(
  component: Component,
  language = "en",
): string {
  if (component.label?.[language]) {
    return component.label[language];
  }
  switch (component.type) {
    case "countryPicker":
      return "destination country";
    case "productPicker":
      return "product selection";
    case "participants":
      return "participants";
    case "timeSlots":
      return "appointment time";
    case "billingDetails":
      return "billing details";
    case "contactDetails":
      return "contact details";
    case "hardCopy":
      return "hard copy delivery";
    case "shippingDetails":
      return "shipping details";
    case "confirmTC":
      return "terms and conditions";
    case "newsletter":
      return "newsletter";
    case "preferredNotary":
      return "preferred notary";
    default:
      return component.type;
  }
}
