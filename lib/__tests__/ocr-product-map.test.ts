import { describe, expect, test } from "bun:test";

import { mapDocumentHintToProduct } from "../ocr-product-map";
import type { ProductDefinition } from "../form-interpreter";

const ES_CATALOG: ProductDefinition[] = [
  {
    id: "sig-1",
    title: { en: "Signature notarisation" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "cert-1",
    title: { en: "Certified copy" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "UpEJ7raQEKQKFhWn12r2",
    title: { en: "Nie number application" },
    apostilleRequired: true,
    fileUploadRequired: true,
  },
];

describe("mapDocumentHintToProduct", () => {
  test("maps generic Power of Attorney to Signature notarisation", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney",
      catalog: ES_CATALOG,
    });

    expect(result.productId).toBe("sig-1");
    expect(result.productTitle).toBe("Signature notarisation");
  });

  test("maps NIE-purpose PoA to Nie number application", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney",
      purposeHint: "obtaining a Spanish Foreign Identity Number (NIE)",
      summary:
        "Power of Attorney authorising an agent to obtain a Spanish NIE",
      catalog: ES_CATALOG,
    });

    expect(result.productId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(result.productTitle).toBe("Nie number application");
  });

  test("flags ambiguity when instrument and purpose disagree without explicit goal", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney for NIE",
      catalog: ES_CATALOG,
    });

    expect(result.ambiguous).toBe(true);
    expect(result.suggestedProductId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(result.alternativeProductIds).toEqual(["sig-1"]);
    expect(result.productId).toBeUndefined();
  });

  test("maps NIE application to Nie number application", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "NIE application form",
      catalog: ES_CATALOG,
    });

    expect(result.productId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(result.productTitle).toBe("Nie number application");
  });

  test("returns empty when hint does not match any catalog product", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "random unknown document type xyz",
      catalog: ES_CATALOG,
    });

    expect(result.productId).toBeUndefined();
    expect(result.productTitle).toBeUndefined();
  });
});
