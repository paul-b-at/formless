import { describe, expect, test } from "bun:test";

import {
  buildProductSelectionsForEdit,
  buildSessionFileOwnersForProductEdit,
  editableFileProductIds,
  mergeBookingFilesForProductEdit,
  manualProductIdsFromPayload,
  productAcceptsFiles,
} from "../../components/product-edit";
import type { ProductDefinition } from "../form-interpreter";

const catalog: ProductDefinition[] = [
  {
    id: "main",
    title: { en: "Nie number application" },
    apostilleRequired: true,
    fileUploadRequired: true,
  },
  {
    id: "auto",
    title: { en: "Auto-added product" },
    fileUploadRequired: true,
  },
];

describe("product-edit", () => {
  test("manualProductIdsFromPayload excludes auto-added companions", () => {
    expect(
      manualProductIdsFromPayload(
        [
          {
            id: "main",
            apostille: true,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: ["a.pdf"],
          },
          {
            id: "auto",
            apostille: null,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: ["b.pdf"],
          },
        ],
        catalog,
      ),
    ).toEqual(["main"]);
  });

  test("buildProductSelectionsForEdit preserves files on kept products", () => {
    const current = [
      {
        id: "main",
        apostille: true,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["a.pdf"],
      },
    ];
    const next = buildProductSelectionsForEdit(["main"], current, catalog);
    expect(next[0]?.files).toEqual(["a.pdf"]);
  });

  test("buildProductSelectionsForEdit applies edited file lists", () => {
    const current = [
      {
        id: "main",
        apostille: true,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["a.pdf"],
      },
    ];
    const next = buildProductSelectionsForEdit(["main"], current, catalog, {
      main: ["b.pdf"],
    });
    expect(next[0]?.files).toEqual(["b.pdf"]);
  });

  test("editableFileProductIds includes companions when a manual product is selected", () => {
    expect(
      editableFileProductIds(
        ["main"],
        [
          {
            id: "main",
            apostille: true,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: [],
          },
          {
            id: "auto",
            apostille: null,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: ["b.pdf"],
          },
        ],
        catalog,
      ),
    ).toEqual(["main", "auto"]);
  });

  test("mergeBookingFilesForProductEdit drops removed files and appends new ones", () => {
    const existing = [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")];
    const added = [new File(["c"], "c.pdf")];
    const merged = mergeBookingFilesForProductEdit(existing, added, ["a.pdf"]);
    expect(merged.map((file) => file.name)).toEqual(["b.pdf", "c.pdf"]);
  });

  test("buildSessionFileOwnersForProductEdit maps filenames to product ids", () => {
    expect(
      buildSessionFileOwnersForProductEdit({
        main: ["a.pdf"],
        auto: ["b.pdf"],
      }),
    ).toEqual({
      "a.pdf": "main",
      "b.pdf": "auto",
    });
  });

  test("productAcceptsFiles respects upload flags", () => {
    expect(productAcceptsFiles(catalog[0])).toBe(true);
    expect(
      productAcceptsFiles({
        id: "plain",
        title: { en: "Plain" },
      }),
    ).toBe(false);
  });
});
