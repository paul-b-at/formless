import { z } from "zod";

export const BusinessDetails = z.object({
  companyName: z.string(),
  vat: z.string().optional().default(""),
});

// A billing / contact / shipping party
export const Party = z.object({
  firstName: z.string(),
  lastName: z.string(),
  business: z.boolean().default(false),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  address: z.string().optional(),
  zipCode: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  countryCode: z.string().length(2).optional(), // ISO-3166 alpha-2
  businessDetails: BusinessDetails.optional(),
});

export const ProductSelection = z.object({
  id: z.string(), // product id from /products/tags
  apostille: z.boolean().nullable(), // honour showApostille / apostilleRequired
  userInput: z.string().default(""),
  documentsNotReadyYet: z.boolean().default(false),
  needHelpDrafting: z.boolean().default(false),
  proofOfRepresentation: z.string().nullable().default(null),
  files: z.array(z.string()).default([]), // MUST match uploaded multipart filenames
});

export const AppointmentRequest = z.object({
  _bookingForm: z.string(), // id from /booking-form/slug
  _appointmentRequestDraft: z.string().optional(), // draft id = safe testing
  mode: z.enum(["debug", "live"]).default("debug"),
  destinationCountry: z.string().length(2),
  language: z.string().default("en"),
  timezone: z.string().default("Europe/Vienna"),
  origin: z.string(),
  products: z.array(ProductSelection).min(1),
  participants: z
    .array(
      z.object({
        email: z.string().email(),
        client: z.boolean(),
        supervisor: z.boolean(),
      }),
    )
    .min(1),
  timeslots: z.array(z.string()).min(1), // ids from /timeslots
  hardCopy: z.object({
    hardCopy: z.boolean().default(false),
    expressShipping: z.boolean().default(false),
  }),
  billingDetails: Party,
  contactDetails: Party.partial().extend({
    contactDetailsSameAsBillingDetails: z.boolean().default(true),
  }),
  shippingDetails: Party.partial()
    .extend({
      shippingDetailsSameAsBillingDetails: z.boolean().default(false),
    })
    .optional(), // present when hardCopy.hardCopy === true
  newsletter: z.boolean().default(false),
  preferredNotary: z.string().default(""),
  instant: z.boolean().default(false),
  instantNotarisationSupported: z.boolean().default(false),
  confirmedPrice: z.number(), // EUROS = sum of /price net (cents) / 100
});

export type ProductSelection = z.infer<typeof ProductSelection>;
export type AppointmentRequest = z.infer<typeof AppointmentRequest>;
