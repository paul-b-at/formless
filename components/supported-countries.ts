import {
  getCountryOptions,
  parseBookingForm,
  type BookingFormSchema,
  type CountryOption,
} from "@/lib/form-interpreter";

function normalizeForm(form: BookingFormSchema | unknown): BookingFormSchema {
  if (
    form &&
    typeof form === "object" &&
    "pages" in form &&
    Array.isArray((form as BookingFormSchema).pages)
  ) {
    return form as BookingFormSchema;
  }
  return parseBookingForm(form);
}

/**
 * Destination countries the live booking-form config supports (picker + banner).
 * Delegates to getCountryOptions → getSupportedDestinationCountryCodes (engine source of truth).
 */
export function getSupportedDestinationCountries(
  formInput: BookingFormSchema | unknown,
): CountryOption[] {
  const form = normalizeForm(formInput);
  return getCountryOptions(form);
}
