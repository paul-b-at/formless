import type { ProductSelection } from "./booking-schema";
import type { Collected, ProductDefinition } from "./form-interpreter";
import { getProductDef, productDisplayName } from "./form-interpreter";

export const PROOF_OF_REPRESENTATION_ACCESSOR = "proofOfRepresentation";

export function needsProofOfRepresentationDecision(
  product: ProductSelection,
  def: ProductDefinition | undefined,
  participantCount: number,
): boolean {
  if (!def?.showProofOfRepresentation) {
    return false;
  }
  if (
    product.proofOfRepresentation !== null &&
    product.proofOfRepresentation !== undefined
  ) {
    return false;
  }
  if (def.proofOfRepresentationRequired) {
    return true;
  }
  return participantCount >= 2;
}

export function getPendingProofProduct(
  collected: Collected,
  catalog: ProductDefinition[],
): { product: ProductSelection; def: ProductDefinition; label: string } | null {
  const participantCount =
    collected.participants?.filter((row) => row.email?.trim()).length ?? 0;

  for (const product of collected.products ?? []) {
    const def = getProductDef(product.id, catalog);
    if (needsProofOfRepresentationDecision(product, def, participantCount) && def) {
      return {
        product,
        def,
        label: productDisplayName(def, product.id),
      };
    }
  }

  return null;
}

export function setProductProofOfRepresentation(
  collected: Collected,
  productId: string,
  value: boolean,
): Collected {
  const products = (collected.products ?? []).map((product) =>
    product.id === productId
      ? { ...product, proofOfRepresentation: value }
      : product,
  );
  return { ...collected, products };
}

export function parseProofOfRepresentationAnswer(
  message: string,
): boolean | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (
    /^(yes|y|true|required|include|add)\b/i.test(lower) ||
    /need.*proof|with proof|attorney|represent|power of attorney/i.test(lower)
  ) {
    return true;
  }
  if (
    /^(no|n|false|without|skip)\b/i.test(lower) ||
    /no proof|not needed|without proof/i.test(lower)
  ) {
    return false;
  }

  return undefined;
}
