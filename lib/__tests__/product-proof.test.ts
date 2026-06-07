import { describe, expect, test } from "bun:test";

import type { ProductDefinition } from "../form-interpreter";
import {
  getPendingProofProduct,
  needsProofOfRepresentationDecision,
  parseProofOfRepresentationAnswer,
  setProductProofOfRepresentation,
} from "../product-proof";

const poaDef: ProductDefinition = {
  id: "ujwBkZleJLPEzByCnPCS",
  title: { en: "Signature notarisation" },
  showProofOfRepresentation: true,
  proofOfRepresentationRequired: false,
};

describe("product-proof", () => {
  test("needs proof when two participants and showProofOfRepresentation", () => {
    expect(
      needsProofOfRepresentationDecision(
        {
          id: poaDef.id,
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        },
        poaDef,
        2,
      ),
    ).toBe(true);
  });

  test("single participant does not require proof decision", () => {
    expect(
      needsProofOfRepresentationDecision(
        {
          id: poaDef.id,
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        },
        poaDef,
        1,
      ),
    ).toBe(false);
  });

  test("getPendingProofProduct returns product after two signers", () => {
    const pending = getPendingProofProduct(
      {
        destinationCountry: "LT",
        products: [
          {
            id: poaDef.id,
            apostille: null,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: [],
          },
        ],
        participants: [
          { email: "a@test.com", client: true, supervisor: false },
          { email: "b@test.com", client: true, supervisor: false },
        ],
      },
      [poaDef],
    );
    expect(pending?.product.id).toBe(poaDef.id);
  });

  test("setProductProofOfRepresentation updates matching product", () => {
    const next = setProductProofOfRepresentation(
      {
        products: [
          {
            id: poaDef.id,
            apostille: null,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: [],
          },
        ],
      },
      poaDef.id,
      true,
    );
    expect(next.products?.[0]?.proofOfRepresentation).toBe(true);
  });

  test("parseProofOfRepresentationAnswer handles yes/no", () => {
    expect(parseProofOfRepresentationAnswer("Yes, include proof")).toBe(true);
    expect(parseProofOfRepresentationAnswer("No proof needed")).toBe(false);
    expect(parseProofOfRepresentationAnswer("maybe")).toBeUndefined();
  });
});
