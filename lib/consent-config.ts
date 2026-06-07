import {
  visibleComponents,
  type BookingFormSchema,
  type Collected,
  type Component,
} from "./form-interpreter";

export type ConsentConfig = {
  showNewsletter: boolean;
  termsRequired: boolean;
  newsletterComponent: Component | null;
  termsComponent: Component | null;
};

export function isConsentComponent(component: Component): boolean {
  return (
    component.type === "confirmTC" ||
    component.type === "newsletter" ||
    component.accessor === "newsletter"
  );
}

function isConsentComponentFilled(
  component: Component,
  _collected: Collected,
  _config: ConsentConfig,
): boolean {
  if (component.type === "confirmTC") {
    return true;
  }
  if (
    component.type === "newsletter" ||
    component.accessor === "newsletter"
  ) {
    return true;
  }
  return true;
}

export function pendingConsentComponents(
  form: BookingFormSchema,
  collected: Collected,
): Component[] {
  const config = getConsentConfig(form, collected);
  return visibleComponents(form, collected).filter(
    (component) =>
      isConsentComponent(component) &&
      !isConsentComponentFilled(component, collected, config),
  );
}

export function getConsentConfig(
  form: BookingFormSchema,
  collected: Collected = {},
): ConsentConfig {
  const visible = visibleComponents(form, collected);
  const newsletterComponent =
    visible.find(
      (component) =>
        component.type === "newsletter" || component.accessor === "newsletter",
    ) ?? null;
  const termsComponent =
    visible.find((component) => component.type === "confirmTC") ?? null;
  const showNewsletter = newsletterComponent !== null;
  const termsRequired =
    termsComponent !== null && termsComponent.props?.required !== false;

  return {
    showNewsletter,
    termsRequired,
    newsletterComponent,
    termsComponent,
  };
}
