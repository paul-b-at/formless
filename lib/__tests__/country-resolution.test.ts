import { describe, expect, test } from "bun:test";

import {
  normalizeCountryMatchKey,
  resolveDestinationCountryAnswer,
  resolveDestinationCountryInput,
} from "../country-resolution";
import { parseBookingForm, type BookingFormSchema } from "../form-interpreter";

const fixtureForm: BookingFormSchema = parseBookingForm({
  id: "kmVXjYM937qB8JTYG2yH",
  pages: [
    {
      title: { en: "Product" },
      slug: "page-1",
      components: [
        {
          id: "country",
          type: "countryPicker",
          accessor: "destinationCountry",
        },
        {
          id: "dest-cond",
          type: "condition",
          props: {
            condition: "ISDEFINED",
            compare: "destinationCountry",
            components: [
              {
                id: "es-branch",
                type: "condition",
                props: {
                  condition: "EQUAL",
                  compare: "destinationCountry",
                  value: "ES",
                  components: [
                    {
                      id: "es-products",
                      type: "productPicker",
                      props: { tags: ["tag-es"] },
                      accessor: "products",
                    },
                  ],
                  elseComponents: [
                    {
                      id: "generic-products",
                      type: "productPicker",
                      props: { tags: ["tag-generic"] },
                      accessor: "products",
                    },
                  ],
                },
              },
            ],
            elseComponents: [],
          },
        },
      ],
    },
    {
      title: { en: "Appointment" },
      slug: "page-2",
      components: [
        {
          id: "at-slot-cond",
          type: "condition",
          props: {
            condition: "EQUAL",
            compare: "destinationCountry",
            value: "AT",
            components: [
              {
                id: "at-slot",
                type: "timeSlots",
                props: { timeslotLabel: "at-label" },
                accessor: "timeslots",
              },
            ],
            elseComponents: [
              {
                id: "other-slot",
                type: "timeSlots",
                props: { timeslotLabel: "other-label" },
                accessor: "timeslots",
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("country-resolution", () => {
  test("normalizeCountryMatchKey strips diacritics", () => {
    expect(normalizeCountryMatchKey("Österreich")).toBe("osterreich");
    expect(normalizeCountryMatchKey("España")).toBe("espana");
  });

  test("resolves supported country names and codes", () => {
    for (const input of [
      "Austria",
      "austria",
      "Österreich",
      "AT",
      "Spain",
      "españa",
      "ES",
      "Spain (ES)",
      "Lithuania (LT)",
    ]) {
      const resolution = resolveDestinationCountryAnswer(input, fixtureForm);
      expect(resolution.status).toBe("resolved");
      if (resolution.status === "resolved") {
        const expected = input.includes("LT")
          ? "LT"
          : input.toUpperCase().includes("ES") || /spain|espa/i.test(input)
            ? "ES"
            : "AT";
        expect(resolution.code).toBe(expected);
      }
    }
  });

  test("resolveDestinationCountryInput returns ISO code on hit", () => {
    expect(resolveDestinationCountryInput("Austria", fixtureForm)).toBe("AT");
    expect(resolveDestinationCountryInput("Spain", fixtureForm)).toBe("ES");
    expect(resolveDestinationCountryInput("LT", fixtureForm)).toBe("LT");
    expect(resolveDestinationCountryInput("Lithuania", fixtureForm)).toBe("LT");
  });

  test("Germany resolves when generic else accepts all ISO countries", () => {
    expect(resolveDestinationCountryAnswer("Germany", fixtureForm).status).toBe(
      "resolved",
    );
    expect(resolveDestinationCountryInput("Germany", fixtureForm)).toBe("DE");
  });

  test("Germany is unsupported on explicit-only forms", () => {
    const explicitOnly = parseBookingForm({
      id: "explicit-only",
      pages: [
        {
          title: { en: "P" },
          slug: "p",
          components: [
            {
              id: "country",
              type: "countryPicker",
              accessor: "destinationCountry",
            },
            {
              id: "es-only",
              type: "condition",
              props: {
                condition: "EQUAL",
                compare: "destinationCountry",
                value: "ES",
                components: [
                  {
                    id: "es-products",
                    type: "productPicker",
                    props: { tags: ["tag-es"] },
                    accessor: "products",
                  },
                ],
                elseComponents: [],
              },
            },
          ],
        },
      ],
    });
    const resolution = resolveDestinationCountryAnswer("Germany", explicitOnly);
    expect(resolution.status).toBe("unsupported");
    expect(resolveDestinationCountryInput("Germany", explicitOnly)).toBeNull();
  });

  test("ambiguous partial matches stay unmatched", () => {
    expect(resolveDestinationCountryAnswer("land", fixtureForm).status).toBe(
      "unmatched",
    );
  });
});
