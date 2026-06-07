"use client";

import { useMemo, useRef, useState } from "react";

import { FileAttachmentList } from "@/components/FileAttachmentChip";
import {
  buildProductSelectionsForEdit,
  catalogPickerProducts,
  editableFileProductIds,
  initialFilesByProductId,
  manualProductIdsFromPayload,
  productAcceptsFiles,
  type ProductEditResult,
} from "@/components/product-edit";
import { Button } from "@/components/ui/button";
import type { ProductSelection } from "@/lib/booking-schema";
import type { ProductDefinition } from "@/lib/form-interpreter";
import { cn } from "@/lib/utils";

const ACCEPT =
  "application/pdf,.pdf,image/jpeg,image/png,image/webp";

type ProductEditPanelProps = {
  catalog: ProductDefinition[];
  currentProducts: ProductSelection[];
  bookingFiles: File[];
  loading?: boolean;
  onConfirm: (result: ProductEditResult) => void;
  onCancel: () => void;
};

export function ProductEditPanel({
  catalog,
  currentProducts,
  bookingFiles,
  loading = false,
  onConfirm,
  onCancel,
}: ProductEditPanelProps): React.ReactElement {
  const pickerProducts = useMemo(
    () => catalogPickerProducts(catalog),
    [catalog],
  );

  const originalFilenames = useMemo(
    () => new Set(bookingFiles.map((file) => file.name)),
    [bookingFiles],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    manualProductIdsFromPayload(currentProducts, catalog),
  );

  const [filesByProductId, setFilesByProductId] = useState<
    Record<string, string[]>
  >(() => initialFilesByProductId(currentProducts));

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [removedFileNames, setRemovedFileNames] = useState<string[]>([]);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fileProductIds = useMemo(
    () =>
      editableFileProductIds(selectedIds, currentProducts, catalog).filter(
        (productId) => productAcceptsFiles(catalog.find((def) => def.id === productId)),
      ),
    [catalog, currentProducts, selectedIds],
  );

  const fileSizes = useMemo(() => {
    const sizes = Object.fromEntries(
      bookingFiles.map((file) => [file.name, file.size]),
    );
    for (const file of pendingFiles) {
      sizes[file.name] = file.size;
    }
    return sizes;
  }, [bookingFiles, pendingFiles]);

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => {
      if (current.includes(productId)) {
        if (current.length === 1) {
          return current;
        }
        const next = current.filter((id) => id !== productId);
        setFilesByProductId((files) => {
          const updated = { ...files };
          delete updated[productId];
          return updated;
        });
        return next;
      }
      return [...current, productId];
    });
  };

  const addFileForProduct = (productId: string, file: File) => {
    setFilesByProductId((current) => ({
      ...current,
      [productId]: [...(current[productId] ?? []).filter((name) => name !== file.name), file.name],
    }));
    setPendingFiles((current) => [
      ...current.filter((entry) => entry.name !== file.name),
      file,
    ]);
    setRemovedFileNames((current) =>
      current.filter((name) => name !== file.name),
    );
  };

  const removeFileForProduct = (productId: string, filename: string) => {
    setFilesByProductId((current) => ({
      ...current,
      [productId]: (current[productId] ?? []).filter((name) => name !== filename),
    }));
    setPendingFiles((current) => current.filter((file) => file.name !== filename));
    if (originalFilenames.has(filename)) {
      setRemovedFileNames((current) =>
        current.includes(filename) ? current : [...current, filename],
      );
    }
  };

  const handleSave = () => {
    const products = buildProductSelectionsForEdit(
      selectedIds,
      currentProducts,
      catalog,
      filesByProductId,
    );

    onConfirm({
      products,
      newFiles: pendingFiles,
      removedFileNames,
      filesByProductId,
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Select the products you need. Companion products (e.g. NIE Personal Data)
        are added automatically when required.
      </p>
      <div className="flex flex-wrap gap-2">
        {pickerProducts.map((product) => {
          const selected = selectedIds.includes(product.id);
          const attachedFiles = filesByProductId[product.id] ?? [];
          return (
            <Button
              key={product.id}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              disabled={loading}
              className={cn(
                "h-auto min-w-0 max-w-full whitespace-normal py-1.5 text-left",
                selected && "ring-2 ring-primary",
              )}
              aria-pressed={selected}
              onClick={() => toggleProduct(product.id)}
            >
              {product.title.en ?? product.id}
              {attachedFiles.length > 0 ? (
                <span className="ml-1.5 text-xs opacity-80">
                  · {attachedFiles.length} file
                  {attachedFiles.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>

      {fileProductIds.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Documents
          </p>
          {fileProductIds.map((productId) => {
            const def = catalog.find((entry) => entry.id === productId);
            const label = def?.title.en ?? productId;
            const filenames = filesByProductId[productId] ?? [];

            return (
              <div key={productId} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{label}</p>
                {filenames.length > 0 ? (
                  <FileAttachmentList
                    filenames={filenames}
                    fileSizes={fileSizes}
                    onRemove={(filename) => removeFileForProduct(productId, filename)}
                    removeDisabled={loading}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">No files attached yet.</p>
                )}
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => fileInputRefs.current[productId]?.click()}
                  >
                    Add file
                  </Button>
                  <input
                    ref={(element) => {
                      fileInputRefs.current[productId] = element;
                    }}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    disabled={loading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        addFileForProduct(productId, file);
                      }
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={loading || selectedIds.length === 0}
          onClick={handleSave}
        >
          Save products
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
