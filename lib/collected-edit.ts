import type {
  BookingFormSchema,
  Collected,
  Component,
  ConditionExpr,
} from "./form-interpreter";
import { getAccessor, isInputComponent } from "./form-interpreter";

function isLeafCondition(
  condition: ConditionExpr,
): condition is Extract<ConditionExpr, { compare: string }> {
  return (
    condition.condition !== "AND" &&
    condition.condition !== "OR" &&
    condition.condition !== "NOT"
  );
}

function rootAccessor(compare: string): string {
  return compare.split(".")[0] ?? compare;
}

/** Collect root accessor paths referenced in a condition tree. */
export function collectConditionRoots(condition: ConditionExpr): Set<string> {
  const roots = new Set<string>();

  function walk(expr: ConditionExpr): void {
    if (expr.condition === "AND" || expr.condition === "OR") {
      for (const child of expr.conditions) {
        walk(child);
      }
      return;
    }
    if (expr.condition === "NOT") {
      for (const child of expr.conditions) {
        walk(child);
      }
      return;
    }
    if (isLeafCondition(expr) && expr.compare) {
      roots.add(rootAccessor(expr.compare));
    }
  }

  walk(condition);
  return roots;
}

function walkComponents(
  components: Component[],
  ancestorConditions: ConditionExpr[],
  accessorOrder: string[],
  visibilityDeps: Map<string, Set<string>>,
): void {
  for (const component of components) {
    if (component.hidden) {
      continue;
    }

    if (component.type === "condition") {
      const expr = component.props as ConditionExpr | undefined;
      if (!expr) {
        continue;
      }
      const nextAncestors = [...ancestorConditions, expr];
      walkComponents(
        component.props?.components ?? [],
        nextAncestors,
        accessorOrder,
        visibilityDeps,
      );
      walkComponents(
        component.props?.elseComponents ?? [],
        nextAncestors,
        accessorOrder,
        visibilityDeps,
      );
      continue;
    }

    if (!isInputComponent(component)) {
      continue;
    }

    const accessor = getAccessor(component);
    if (!accessor) {
      continue;
    }

    if (!accessorOrder.includes(accessor)) {
      accessorOrder.push(accessor);
    }

    const deps = new Set<string>();
    for (const cond of ancestorConditions) {
      for (const root of collectConditionRoots(cond)) {
        deps.add(root);
      }
    }
    visibilityDeps.set(accessor, deps);
  }
}

export function buildAccessorMetadata(form: BookingFormSchema): {
  order: string[];
  visibilityDeps: Map<string, Set<string>>;
} {
  const order: string[] = [];
  const visibilityDeps = new Map<string, Set<string>>();

  for (const page of form.pages) {
    walkComponents(page.components, [], order, visibilityDeps);
  }

  return { order, visibilityDeps };
}

function deleteAccessor(collected: Collected, accessor: string): void {
  switch (accessor) {
    case "products":
      delete collected.products;
      break;
    case "participants":
      delete collected.participants;
      break;
    case "timeslots":
      delete collected.timeslots;
      break;
    case "billingDetails":
      delete collected.billingDetails;
      break;
    case "contactDetails":
      delete collected.contactDetails;
      break;
    case "hardCopy":
      delete collected.hardCopy;
      break;
    case "shippingDetails":
      delete collected.shippingDetails;
      break;
    case "destinationCountry":
      delete collected.destinationCountry;
      break;
    case "newsletter":
      delete collected.newsletter;
      break;
    case "confirmTC":
      delete collected.termsAccepted;
      break;
    default:
      delete (collected as Record<string, unknown>)[accessor];
  }
}

/** Clear only downstream fields whose visibility depends on the edited accessor. */
export function clearDependentsOf(
  form: BookingFormSchema,
  collected: Collected,
  editedAccessor: string,
): Collected {
  const next: Collected = { ...collected };
  const { order, visibilityDeps } = buildAccessorMetadata(form);
  const editedIndex = order.indexOf(editedAccessor);
  if (editedIndex < 0) {
    return next;
  }

  for (let index = editedIndex + 1; index < order.length; index += 1) {
    const accessor = order[index]!;
    const deps = visibilityDeps.get(accessor);
    if (deps?.has(editedAccessor)) {
      deleteAccessor(next, accessor);
    }
  }

  return next;
}
