import type { ProductSelection } from "@/lib/booking-schema";
import type { ProductDefinition } from "@/lib/form-interpreter";

const AUTO_ADDED_LABEL = "Auto-added product";

export type ProductEditResult = {
  products: ProductSelection[];
  newFiles: File[];
  removedFileNames: string[];
  filesByProductId: Record<string, string[]>;
};

export function productAcceptsFiles(
  def: ProductDefinition | undefined,
): boolean {
  return Boolean(def?.fileUploadRequired || def?.showFileUpload);
}

/** Picker selections plus companion products still on the booking. */
export function editableFileProductIds(
  selectedIds: string[],
  currentProducts: ProductSelection[],
  catalog: ProductDefinition[],
): string[] {
  if (selectedIds.length === 0) {
    return [];
  }

  const pickerIds = new Set(
    catalogPickerProducts(catalog).map((product) => product.id),
  );
  const companions = currentProducts
    .map((product) => product.id)
    .filter((id) => !pickerIds.has(id));

  return [...selectedIds, ...companions];
}

export function initialFilesByProductId(
  products: ProductSelection[],
): Record<string, string[]> {
  return Object.fromEntries(
    products.map((product) => [product.id, [...product.files]]),
  );
}

export function mergeBookingFilesForProductEdit(
  existing: File[],
  newFiles: File[],
  removedFileNames: string[],
): File[] {
  const removed = new Set(removedFileNames);
  const kept = existing.filter((file) => !removed.has(file.name));
  const keptNames = new Set(kept.map((file) => file.name));
  const added = newFiles.filter((file) => !keptNames.has(file.name));
  return [...kept, ...added];
}

export function buildSessionFileOwnersForProductEdit(
  filesByProductId: Record<string, string[]>,
): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const [productId, filenames] of Object.entries(filesByProductId)) {
    for (const filename of filenames) {
      owners[filename] = productId;
    }
  }
  return owners;
}

export function catalogPickerProducts(
  catalog: ProductDefinition[],
): ProductDefinition[] {
  return catalog.filter((product) => product.title.en !== AUTO_ADDED_LABEL);
}

/** Manual product ids currently on the booking (excludes auto-added companions). */
export function manualProductIdsFromPayload(
  products: ProductSelection[],
  catalog: ProductDefinition[],
): string[] {
  const pickerIds = new Set(catalogPickerProducts(catalog).map((product) => product.id));
  return products.map((product) => product.id).filter((id) => pickerIds.has(id));
}

export function buildProductSelectionsForEdit(
  selectedIds: string[],
  currentProducts: ProductSelection[],
  catalog: ProductDefinition[],
  filesByProductId?: Record<string, string[]>,
): ProductSelection[] {
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));

  return selectedIds.map((id) => {
    const existing = currentById.get(id);
    const def = catalog.find((product) => product.id === id);
    const files = filesByProductId?.[id] ?? existing?.files ?? [];

    if (existing) {
      return {
        ...existing,
        files: [...files],
      };
    }

    return {
      id,
      apostille: def?.apostilleRequired ? true : null,
      userInput: "",
      documentsNotReadyYet: false,
      needHelpDrafting: false,
      proofOfRepresentation: null,
      files: [...files],
    };
  });
}
