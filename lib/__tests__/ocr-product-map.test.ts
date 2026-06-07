import { describe, expect, test } from "bun:test";

import {
  hasOcrProductSuggestion,
  mapDocumentHintToProduct,
  sortProductOptionsWithSuggestion,
} from "../ocr-product-map";
import type { ProductDefinition } from "../form-interpreter";

const ES_CATALOG: ProductDefinition[] = [
  {
    id: "sig-1",
    title: { en: "Signature notarisation" },
    description: { en: "Notarise signatures online" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "cert-1",
    title: { en: "Certified copy" },
    description: { en: "Certify document copies" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "UpEJ7raQEKQKFhWn12r2",
    title: { en: "Nie number application" },
    description: { en: "Apply for a Spanish NIE number" },
    apostilleRequired: true,
    fileUploadRequired: true,
  },
];

const AT_CATALOG: ProductDefinition[] = [
  {
    id: "obYErsteOOFvHQtPD7ZV",
    title: { en: "GmbH incoorporation" },
    description: { en: "Establish a GmbH online with one of our partner notaries" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "S3N2zyJENFE0vTjrKTZn",
    title: { en: "FlexCo Incorporation" },
    description: { en: "Establish a FlexCo online with one of our partner notaries" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
  {
    id: "Hcn6OVIEa57bUwdOgfJ5",
    title: { en: "Signature Notarisation" },
    description: { en: "Notarise signatures online" },
    apostilleRequired: false,
    fileUploadRequired: false,
  },
];

describe("mapDocumentHintToProduct", () => {
  test("maps generic Power of Attorney to Signature notarisation", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney",
      catalog: ES_CATALOG,
    });

    expect(result.suggestedProductId).toBe("sig-1");
    expect(result.productTitle).toBe("Signature notarisation");
    expect(result.productConfidence).toBe("high");
  });

  test("maps NIE-purpose PoA to Nie number application", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney",
      purposeHint: "obtaining a Spanish Foreign Identity Number (NIE)",
      summary:
        "Power of Attorney authorising an agent to obtain a Spanish NIE",
      catalog: ES_CATALOG,
    });

    expect(result.suggestedProductId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(result.productTitle).toBe("Nie number application");
    expect(result.productConfidence).toBe("high");
  });

  test("flags ambiguity without surfacing a suggestion", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Power of Attorney for NIE",
      catalog: ES_CATALOG,
    });

    expect(result.ambiguous).toBe(true);
    expect(result.suggestedProductId).toBeUndefined();
    expect(result.alternativeProductIds).toEqual(["UpEJ7raQEKQKFhWn12r2", "sig-1"]);
  });

  test("maps NIE application to Nie number application", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "NIE application form",
      catalog: ES_CATALOG,
    });

    expect(result.suggestedProductId).toBe("UpEJ7raQEKQKFhWn12r2");
    expect(result.productTitle).toBe("Nie number application");
    expect(result.productConfidence).toBe("high");
  });

  test("maps FlexCo articles of association via catalog semantics", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "Articles of Association",
      purposeHint: "company formation",
      summary:
        "Articles of Association for the formation of the company Midgley Tech EU FlexCo in Vienna, Austria.",
      documentType: "Articles of Association",
      catalog: AT_CATALOG,
    });

    expect(result.suggestedProductId).toBe("S3N2zyJENFE0vTjrKTZn");
    expect(result.productTitle).toBe("FlexCo Incorporation");
    expect(result.productConfidence).toBe("high");
    expect(result.productMatchReason).toContain("FlexCo Incorporation");
  });

  test("returns empty when hint does not match any catalog product", async () => {
    const result = await mapDocumentHintToProduct({
      productHint: "random unknown document type xyz",
      catalog: ES_CATALOG,
    });

    expect(result.suggestedProductId).toBeUndefined();
    expect(result.productTitle).toBeUndefined();
  });
});

describe("hasOcrProductSuggestion", () => {
  test("shows suggestion only on high-confidence mapped product", () => {
    expect(
      hasOcrProductSuggestion({
        suggestedProductId: "S3N2zyJENFE0vTjrKTZn",
        productConfidence: "high",
      }),
    ).toBe(true);
    expect(
      hasOcrProductSuggestion({
        suggestedProductId: "S3N2zyJENFE0vTjrKTZn",
        productConfidence: "medium",
      }),
    ).toBe(false);
    expect(
      hasOcrProductSuggestion({
        suggestedProductId: "S3N2zyJENFE0vTjrKTZn",
        productConfidence: "high",
        ambiguousProduct: true,
      }),
    ).toBe(false);
  });
});

describe("sortProductOptionsWithSuggestion", () => {
  test("puts suggested product first", () => {
    const options = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
      { id: "c", title: "Gamma" },
    ];
    expect(sortProductOptionsWithSuggestion(options, "b").map((entry) => entry.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
