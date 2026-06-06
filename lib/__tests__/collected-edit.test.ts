import { describe, expect, test } from "bun:test";

import { buildAccessorMetadata, clearDependentsOf } from "../collected-edit";
import type { BookingFormSchema } from "../form-interpreter";

const miniForm: BookingFormSchema = {
  id: "test",
  pages: [
    {
      components: [
        {
          id: "c1",
          type: "countryPicker",
          accessor: "destinationCountry",
        },
        {
          id: "c2",
          type: "condition",
          props: {
            condition: "INCLUDES",
            compare: "destinationCountry",
            value: '["ES"]',
            components: [
              {
                id: "p1",
                type: "productPicker",
                accessor: "products",
              },
            ],
          },
        },
        {
          id: "t1",
          type: "timeSlots",
          accessor: "timeslots",
        },
        {
          id: "b1",
          type: "billingDetails",
          accessor: "billingDetails",
        },
      ],
    },
  ],
};

describe("collected-edit", () => {
  test("buildAccessorMetadata records destinationCountry dependency", () => {
    const { visibilityDeps } = buildAccessorMetadata(miniForm);
    expect(visibilityDeps.get("products")?.has("destinationCountry")).toBe(true);
    expect(visibilityDeps.get("timeslots")?.has("destinationCountry")).toBe(
      false,
    );
  });

  test("clearDependentsOf clears only downstream fields that depend on the edit", () => {
    const collected = {
      destinationCountry: "ES",
      products: [{ id: "p1", files: [], apostille: true }],
      timeslots: ["slot-1"],
      billingDetails: {
        firstName: "Joshua",
        lastName: "Timms",
        email: "joshua.timms@notarity.com",
        phoneNumber: "+12125550174",
        business: false,
      },
    };

    const next = clearDependentsOf(miniForm, collected, "destinationCountry");
    expect(next.products).toBeUndefined();
    expect(next.timeslots).toEqual(["slot-1"]);
    expect(next.billingDetails).toEqual(collected.billingDetails);
  });

  test("editing billing does not clear unrelated downstream fields", () => {
    const collected = {
      destinationCountry: "ES",
      products: [{ id: "p1", files: [], apostille: true }],
      timeslots: ["slot-1"],
      billingDetails: {
        firstName: "Joshua",
        lastName: "Timms",
        email: "joshua.timms@notarity.com",
        phoneNumber: "+12125550174",
        business: false,
      },
    };

    const next = clearDependentsOf(miniForm, collected, "billingDetails");
    expect(next.products).toEqual(collected.products);
    expect(next.timeslots).toEqual(collected.timeslots);
  });
});
