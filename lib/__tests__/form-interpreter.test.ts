import { describe, expect, test } from "bun:test";

import {
  applyAnswer,
  autoAttachSessionFiles,
  evaluateCondition,
  getDestinationCountryConfig,
  getSupportedDestinationCountryCodes,
  getTimeslotLabel,
  getVisibleProductPickerTags,
  isDestinationCountrySupported,
  nextUnfilled,
  parseBookingForm,
  resolveDestinationCountryInput,
  resolveFileUploadProductId,
  validateFileForProductUpload,
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

  test("supported destination list includes generic-else countries like LT", () => {
    const supported = getSupportedDestinationCountryCodes(fixtureForm);
    expect(supported).toContain("AT");
    expect(supported).toContain("ES");
    expect(supported).toContain("LT");
    expect(supported.length).toBeGreaterThan(2);
  });

  test("LT resolves via generic else branch (Robert path)", () => {
    expect(isDestinationCountrySupported(fixtureForm, "LT")).toBe(true);
    expect(resolveDestinationCountryInput("Lithuania (LT)", fixtureForm)).toBe(
      "LT",
    );
    const tags = getVisibleProductPickerTags(fixtureForm, {
      destinationCountry: "LT",
    });
    expect(tags).toEqual(["t7t78Pbrs5nEyHTqDuQv"]);
    const collected = {
      destinationCountry: "LT",
      products: [
        {
          id: "ujwBkZleJLPEzByCnPCS",
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        },
      ],
      participants: [
        { email: "robert.stevens@notarity.com", client: true, supervisor: false },
      ],
    };
    expect(getTimeslotLabel(fixtureForm, collected)).toBe(
      "29sfIoZ9WgFQl8XjbKPu",
    );
  });

  test("unsupported explicit-only country is rejected", () => {
    const explicitOnly = parseBookingForm({
      id: "test",
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
    expect(getDestinationCountryConfig(explicitOnly).allowsOtherCountries).toBe(
      false,
    );
    expect(isDestinationCountrySupported(explicitOnly, "LT")).toBe(false);
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

  test("applyAnswer attaches pdf filename to first product needing file", () => {
    let collected = applyAnswer(
      fixtureForm,
      {
        destinationCountry: "ES",
        products: [
          {
            id: "UpEJ7raQEKQKFhWn12r2",
            apostille: true,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: [],
          },
          {
            id: "xK5IkgPX1LTYdWLFzW8X",
            apostille: null,
            userInput: "",
            documentsNotReadyYet: false,
            needHelpDrafting: false,
            proofOfRepresentation: null,
            files: [],
          },
        ],
      },
      { type: "productPicker", id: "pp", accessor: "products" },
      "nie-application-demo-joshua_timms.pdf",
      spainCatalog,
    );

    const nieApp = collected.products?.find(
      (product) => product.id === "UpEJ7raQEKQKFhWn12r2",
    );
    const nieData = collected.products?.find(
      (product) => product.id === "xK5IkgPX1LTYdWLFzW8X",
    );

    expect(nieApp?.files).toEqual(["nie-application-demo-joshua_timms.pdf"]);
    expect(nieData?.files).toEqual([]);
  });

  test("applyAnswer attaches second pdf to next product needing file", () => {
    const collected = applyAnswer(
      fixtureForm,
      {
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
            files: [],
          },
        ],
      },
      { type: "productPicker", id: "pp", accessor: "products" },
      "nie_personal_details.pdf",
      spainCatalog,
    );

    const nieData = collected.products?.find(
      (product) => product.id === "xK5IkgPX1LTYdWLFzW8X",
    );
    expect(nieData?.files).toEqual(["nie_personal_details.pdf"]);
  });

  test("autoAttachSessionFiles reuses earlier upload for NIE application", () => {
    let collected = applyAnswer(
      fixtureForm,
      { destinationCountry: "ES" },
      { type: "productPicker", id: "pp", accessor: "products" },
      "UpEJ7raQEKQKFhWn12r2",
      spainCatalog,
    );

    collected = autoAttachSessionFiles(
      fixtureForm,
      collected,
      spainCatalog,
      ["nie-application-demo-joshua_timms.pdf"],
      {
        "nie-application-demo-joshua_timms.pdf": "UpEJ7raQEKQKFhWn12r2",
      },
    );

    const nieApp = collected.products?.find(
      (product) => product.id === "UpEJ7raQEKQKFhWn12r2",
    );
    expect(nieApp?.files).toEqual(["nie-application-demo-joshua_timms.pdf"]);
  });

  test("resolveFileUploadProductId does not assign application pdf to personal data when both need files", () => {
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
          files: [],
        },
        {
          id: "xK5IkgPX1LTYdWLFzW8X",
          apostille: null,
          userInput: "",
          documentsNotReadyYet: false,
          needHelpDrafting: false,
          proofOfRepresentation: null,
          files: [],
        },
      ],
    };

    expect(
      resolveFileUploadProductId(
        "nie-application-demo-joshua_timms.pdf",
        collected,
        spainCatalog,
      ),
    ).toBe("UpEJ7raQEKQKFhWn12r2");

    expect(
      resolveFileUploadProductId(
        "nie-application-demo-joshua_timms.pdf",
        collected,
        spainCatalog,
        "xK5IkgPX1LTYdWLFzW8X",
      ),
    ).toBe("xK5IkgPX1LTYdWLFzW8X");
  });

  test("validateFileForProductUpload rejects file already owned by another product", () => {
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
          files: [],
        },
      ],
    };

    const result = validateFileForProductUpload({
      fileName: "nie-application-demo-joshua_timms.pdf",
      targetProductId: "xK5IkgPX1LTYdWLFzW8X",
      collected,
      catalog: spainCatalog,
      sessionFileOwners: {
        "nie-application-demo-joshua_timms.pdf": "UpEJ7raQEKQKFhWn12r2",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("already attached");
      expect(result.message).toContain("NIE Personal Data");
    }
  });

  test("autoAttachSessionFiles attaches optional showFileUpload product when owner is set", () => {
    const flexCoId = "S3N2zyJENFE0vTjrKTZn";
    const flexCoCatalog: ProductDefinition[] = [
      {
        id: flexCoId,
        title: { en: "FlexCo Incorporation" },
        fileUploadRequired: false,
        showFileUpload: true,
        apostilleRequired: false,
      },
    ];
    const flexCoFile = "Gesellschaftsvertrag_Midgley_Tech_EU_FlexCo.pdf";

    let collected = applyAnswer(
      fixtureForm,
      { destinationCountry: "AT" },
      { type: "productPicker", id: "pp", accessor: "products" },
      flexCoId,
      flexCoCatalog,
    );

    collected = autoAttachSessionFiles(
      fixtureForm,
      collected,
      flexCoCatalog,
      [flexCoFile],
      { [flexCoFile]: flexCoId },
    );

    const flexCo = collected.products?.find((product) => product.id === flexCoId);
    expect(flexCo?.files).toEqual([flexCoFile]);
  });

  test("autoAttachSessionFiles does not cross-assign application pdf to NIE Personal Data", () => {
    let collected = applyAnswer(
      fixtureForm,
      { destinationCountry: "ES" },
      { type: "productPicker", id: "pp", accessor: "products" },
      "UpEJ7raQEKQKFhWn12r2",
      spainCatalog,
    );

    collected = autoAttachSessionFiles(
      fixtureForm,
      collected,
      spainCatalog,
      ["nie-application-demo-joshua_timms.pdf"],
      {
        "nie-application-demo-joshua_timms.pdf": "UpEJ7raQEKQKFhWn12r2",
      },
    );

    const nieData = collected.products?.find(
      (product) => product.id === "xK5IkgPX1LTYdWLFzW8X",
    );
    expect(nieData?.files).toEqual([]);
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
