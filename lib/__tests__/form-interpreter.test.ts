import { describe, expect, test } from "bun:test";

import {
  applyAnswer,
  evaluateCondition,
  nextUnfilled,
  parseBookingForm,
  visibleComponents,
} from "../form-interpreter";
import type { BookingFormSchema, ProductDefinition } from "../form-interpreter";

// Fixture derived from real start-vienna-hackathon schema (page 1 product branch)
const fixtureForm: BookingFormSchema = parseBookingForm({
  id: "kmVXjYM937qB8JTYG2yH",
  _company: "HpKfHmbViXxFEMzjtxln",
  pages: [
    {
      title: { en: "Product" },
      slug: "page-1",
      components: [
        {
          id: "bdd47ce5b424a",
          type: "countryPicker",
          accessor: "destinationCountry",
        },
        {
          id: "d764bc0402605",
          type: "condition",
          props: {
            condition: "ISDEFINED",
            compare: "destinationCountry",
            components: [
              {
                id: "3ccfd98877181",
                type: "condition",
                props: {
                  condition: "EQUAL",
                  compare: "destinationCountry",
                  value: "ES",
                  components: [
                    {
                      id: "5f5e6cf57a904",
                      type: "productPicker",
                      props: {
                        tags: ["HdippWIH77AdMywneldY", "t7t78Pbrs5nEyHTqDuQv"],
                      },
                      accessor: "products",
                    },
                    {
                      id: "f62a5eec8c0a38",
                      type: "condition",
                      props: {
                        condition: "INTERSECTS",
                        compare: "products.id",
                        value: '["UpEJ7raQEKQKFhWn12r2"]',
                        components: [
                          {
                            id: "cf7e2c2e430d3",
                            type: "singleProduct",
                            props: { _product: "xK5IkgPX1LTYdWLFzW8X" },
                            accessor: "products",
                          },
                        ],
                        elseComponents: [],
                      },
                    },
                  ],
                  elseComponents: [
                    {
                      id: "67a92c92e803f8",
                      type: "productPicker",
                      props: { tags: ["t7t78Pbrs5nEyHTqDuQv"] },
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
        { id: "p1", type: "participants", accessor: "participants" },
        {
          id: "ts-cond",
          type: "condition",
          props: {
            condition: "EQUAL",
            compare: "destinationCountry",
            value: "AT",
            components: [
              {
                id: "at-slot",
                type: "timeSlots",
                props: { timeslotLabel: "yYD129MD1NizqtQKkLqN" },
                accessor: "timeslots",
              },
            ],
            elseComponents: [
              {
                id: "es-slot",
                type: "timeSlots",
                props: { timeslotLabel: "29sfIoZ9WgFQl8XjbKPu" },
                accessor: "timeslots",
              },
            ],
          },
        },
      ],
    },
  ],
});

const spainCatalog: ProductDefinition[] = [
  {
    id: "UpEJ7raQEKQKFhWn12r2",
    title: { en: "Nie number application" },
    apostilleRequired: true,
    fileUploadRequired: true,
  },
  {
    id: "xK5IkgPX1LTYdWLFzW8X",
    title: { en: "NIE Personal Data" },
    fileUploadRequired: true,
  },
];

describe("evaluateCondition", () => {
  test("ISDEFINED false when destinationCountry missing", () => {
    expect(
      evaluateCondition(
        { condition: "ISDEFINED", compare: "destinationCountry" },
        {},
      ),
    ).toBe(false);
  });

  test("ISDEFINED true when destinationCountry set", () => {
    expect(
      evaluateCondition(
        { condition: "ISDEFINED", compare: "destinationCountry" },
        { destinationCountry: "ES" },
      ),
    ).toBe(true);
  });

  test("INCLUDES matches country in array", () => {
    expect(
      evaluateCondition(
        { condition: "INCLUDES", compare: "destinationCountry", value: '["AT"]' },
        { destinationCountry: "AT" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { condition: "INCLUDES", compare: "destinationCountry", value: '["AT"]' },
        { destinationCountry: "ES" },
      ),
    ).toBe(false);
  });

  test("EQUAL compares string values", () => {
    expect(
      evaluateCondition(
        { condition: "EQUAL", compare: "destinationCountry", value: "ES" },
        { destinationCountry: "ES" },
      ),
    ).toBe(true);
  });

  test("INTERSECTS checks product ids", () => {
    expect(
      evaluateCondition(
        {
          condition: "INTERSECTS",
          compare: "products.id",
          value: '["UpEJ7raQEKQKFhWn12r2"]',
        },
        {
          products: [{ id: "UpEJ7raQEKQKFhWn12r2", apostille: true, files: [] }],
        },
      ),
    ).toBe(true);
  });

  test("ISTRUE checks boolean path", () => {
    expect(
      evaluateCondition(
        { condition: "ISTRUE", compare: "hardCopy.hardCopy" },
        { hardCopy: { hardCopy: true, expressShipping: false } },
      ),
    ).toBe(true);
  });

  test("AND requires all child conditions", () => {
    expect(
      evaluateCondition(
        {
          condition: "AND",
          conditions: [
            { condition: "ISDEFINED", compare: "destinationCountry" },
            { condition: "EQUAL", compare: "destinationCountry", value: "ES" },
          ],
        },
        { destinationCountry: "ES" },
      ),
    ).toBe(true);
  });
});

describe("nextUnfilled", () => {
  test("first unfilled is destinationCountry on empty collected", () => {
    const next = nextUnfilled(fixtureForm, {}, spainCatalog);
    expect(next?.accessor).toBe("destinationCountry");
  });

  test("after country ES, next is productPicker", () => {
    const next = nextUnfilled(
      fixtureForm,
      { destinationCountry: "ES" },
      spainCatalog,
    );
    expect(next?.type).toBe("productPicker");
    expect(next?.props?.tags).toContain("HdippWIH77AdMywneldY");
  });

  test("non-AT timeslot label visible for Spain", () => {
    const collected = {
      destinationCountry: "ES",
      products: [
        {
          id: "UpEJ7raQEKQKFhWn12r2",
          apostille: true,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: ["nie-application-demo-joshua_timms.pdf"],
        },
        {
          id: "xK5IkgPX1LTYdWLFzW8X",
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: ["nie_personal_details.pdf"],
        },
      ],
      participants: [
        { email: "joshua.timms@notarity.com", client: true, supervisor: false },
      ],
    };
    const visible = visibleComponents(fixtureForm, collected);
    const slot = visible.find((c) => c.type === "timeSlots");
    expect(slot?.props?.timeslotLabel).toBe("29sfIoZ9WgFQl8XjbKPu");
  });

  test("applyAnswer auto-adds NIE Personal Data after NIE application", () => {
    let collected = applyAnswer(
      fixtureForm,
      { destinationCountry: "ES" },
      { type: "productPicker", id: "pp", accessor: "products" },
      "UpEJ7raQEKQKFhWn12r2",
      spainCatalog,
    );
    const ids = collected.products?.map((p) => p.id) ?? [];
    expect(ids).toContain("UpEJ7raQEKQKFhWn12r2");
    expect(ids).toContain("xK5IkgPX1LTYdWLFzW8X");
  });
});
