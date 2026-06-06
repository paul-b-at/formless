<aside>
📋

This is the brain for **Cursor + Claude Code**. Paste it into both `CLAUDE.md` and `.cursorrules` at the repo root. **Updated with notarity's real reference files — the payload + flow below are the actual API contract, not a guess.**

</aside>

## 0 · Staging resources & endpoints

<aside>
🔗

- **API base:** staging-api.notarity.com  ·  **form slug:** `start-vienna-hackathon`
- **Booking form (UI):** staging.notarity.com/#/book/start-vienna-hackathon/
- **No-email test draft:** `vfniS9nfoq8nMpRqQj7Z` → sent as `_appointmentRequestDraft`
- ⚠️ Submit **sends real emails**. Keep `mode: "debug"` + reuse the draft id while testing. The `/price` call is side-effect free.
- ✅ We have notarity's files: `README.md`, `price.js`, `submit-appointment-request.js` + 2 demo PDFs.
</aside>

The **5-call flow** (base `https://staging-api.notarity.com`):

```
1. GET  /booking-form/slug?slug=start-vienna-hackathon         -> form schema (pages, components, conditions)
2. GET  /products/tags?_tags=<tagId>                           -> product defs referenced by productPickers
3. GET  /appointment-requests/timeslots?_timeslotLabel=..&startDate=..&endDate=..  -> available slots
4. POST /appointment-requests/price                            -> authoritative priced line items (cents)
5. POST /appointment-requests                                  -> submit (multipart: payload JSON + files)
```

Steps 1–3 are reads that give you everything to build the selection. **Never compute the price yourself — POST /price and read it back.**

**Known IDs (Spain / Joshua sample):** `_bookingForm` = `kmVXjYM937qB8JTYG2yH` · NIE-application product `UpEJ7raQEKQKFhWn12r2` (apostille required, €550) · NIE-personal-data product `xK5IkgPX1LTYdWLFzW8X` (free, file-upload required, auto-added) · timeslot label `29sfIoZ9WgFQl8XjbKPu` (non-AT) / `yYD129MD1NizqtQKkLqN` (AT).

## 1 · What we're building

A notarity booking assistant: a client arrives with a document and no idea what they need. Through **voice, text chat, or a doc upload**, we read the live booking-form schema, ask only the questions that schema requires (honouring its conditional logic), assemble a **valid appointment-request payload**, price it server-side, and submit it — in **under 3 minutes**.

## 2 · Golden rules (read first, every session)

- The **live booking-form schema** (call #1) is the real source of truth. Our `zod` `AppointmentRequest` in `lib/booking-schema.ts` mirrors the **exact** payload the API accepts — use notarity's field names verbatim, never rename them.
- **Don't hardcode** product ids, tag ids, timeslot labels, or the question list — read them from the form schema. Judges can swap the config; a generic interpreter is the whole point (*"reimagine this flow"*).
- **LLM output is never trusted raw** — parse through zod before it hits any endpoint.
- All notarity calls + secrets live in **server-side route handlers** under `app/api/*`. Never call staging-api or read keys from the client.
- **Never compute price client-side** — POST /price, sum line-item `net` (cents), ÷100 → `confirmedPrice` (euros).
- **`products[].files` strings must exactly match** the multipart filenames you upload at submit.
- Keep `mode: "debug"` + the draft id until the very end. **No secrets in the repo** (`.env.local`; commit `.env.example`).
- **One feature per change. TypeScript strict.**

## 3 · Stack & conventions

- **Bun + TypeScript**, **Next.js (App Router)**
- **UI:** React + Tailwind — dumb / presentational components
- **Validation:** zod (mirrors the real payload)
- **Form interpreter:** walks the schema's `pages[] → components[] → condition` tree and drives the conversation
- **LLM:** **Google Gemini** via `@google/genai` (model e.g. `gemini-2.0-flash`), using structured output (`responseMimeType: "application/json"` + a `responseSchema`); engine in `lib/engine.ts`. Bonus: Gemini is **multimodal** — feed the PDF straight in for the doc step, so you may not need a separate OCR lib at all.
- **Voice:** ElevenLabs (STT + TTS) as an alternate front-end to the **same engine**
- **notarity client** (`lib/notarity.ts`, server only): the 5 calls above

## 4 · Folder structure

```jsx
app/
  page.tsx                # chat UI entry
  api/
    chat/route.ts         # engine turn handler (LLM)
    book/route.ts         # validates payload, prices, proxies submit to notarity
    ocr/route.ts          # doc upload -> text -> infer destinationCountry/product
lib/
  booking-schema.ts       # zod AppointmentRequest = mirrors the REAL payload
  notarity.ts             # the 5 staging calls (SERVER ONLY)
  form-interpreter.ts     # walks pages/components/conditions from call #1
  engine.ts               # answers -> next question / completed payload
components/
  Chat.tsx
  Summary.tsx             # price breakdown + review before submit
  VoiceButton.tsx
.env.example
CLAUDE.md
REPORT.md
```

## 5 · The data contract (REAL payload — from notarity's files)

<aside>
✅

This mirrors the exact payload in `submit-appointment-request.js`. Field names are notarity's — do **not** rename them. Submit is `multipart/form-data`: one `files` part per PDF + one `payload` part (this object, stringified).

</aside>

```tsx
import { z } from "zod"

// A billing / contact / shipping party
export const Party = z.object({
  firstName: z.string(),
  lastName: z.string(),
  business: z.boolean().default(false),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  zipCode: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  countryCode: z.string().length(2).optional(),  // ISO-3166 alpha-2
})

export const ProductSelection = z.object({
  id: z.string(),                          // product id from /products/tags
  apostille: z.boolean().nullable(),       // honour showApostille / apostilleRequired
  userInput: z.string().default(""),
  documentsNotReadyYet: z.boolean().default(false),
  needHelpDrafting: z.boolean().default(false),
  proofOfRepresentation: z.string().nullable().default(null),
  files: z.array(z.string()).default([]),  // MUST match uploaded multipart filenames
})

export const AppointmentRequest = z.object({
  _bookingForm: z.string(),                         // id from /booking-form/slug
  _appointmentRequestDraft: z.string().optional(),  // draft id = safe testing
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
  timeslots: z.array(z.string()).min(1),            // ids from /timeslots
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
    .optional(),                                    // present when hardCopy.hardCopy === true
  newsletter: z.boolean().default(false),
  preferredNotary: z.string().default(""),
  instant: z.boolean().default(false),
  instantNotarisationSupported: z.boolean().default(false),
  confirmedPrice: z.number(),                       // EUROS = sum of /price net (cents) / 100
})

export type AppointmentRequest = z.infer<typeof AppointmentRequest>
```

## 6 · The conversation engine contract

The engine is the shared brain behind **text and voice**. It drives questions **from the form schema**, not a hardcoded list. Each turn: state + latest user message → next question or finished payload.

```tsx
type EngineState = {
  form: BookingFormSchema            // from GET /booking-form/slug
  collected: Partial<AppointmentRequest>
  messages: { role: "user" | "assistant"; content: string }[]
}

type EngineStep =
  | { type: "ask"; accessor: string; question: string; options?: string[] }
  | { type: "complete"; payload: AppointmentRequest }

// Rules:
// - Walk pages[] -> components[]; evaluate `condition` nodes (ISDEFINED,
//   INCLUDES, EQUAL, INTERSECTS, ISTRUE) against `collected` to decide visibility.
// - Only ask for components that are visible AND unfilled.
// - Infer destinationCountry + product from an uploaded doc when available.
// - Mirror auto-add rules (picking NIE application auto-adds NIE Personal Data).
// - Apply smart defaults; confirm rather than interrogate.
// - Call POST /price whenever the selection changes to show a live breakdown.
// - When the payload passes zod, return { type: "complete" }.
```

## 7 · Build order (do NOT skip ahead)

1. **Prove the contract first.** Run notarity's `price.js` (safe) against staging → confirm a 200 + line items. Then run `submit-appointment-request.js` once (`mode: "debug"` + draft id) → confirm a created request. *You already have a known-good Joshua/Spain payload — start from it.*
2. Build `lib/notarity.ts`: the 5 calls (form → products(tags) → timeslots → price → submit).
3. Build `lib/form-interpreter.ts`: parse the schema, evaluate conditions, expose "next visible unfilled component".
4. Build `engine.ts` (text only) → reproduce the Joshua payload end-to-end via conversation.
5. **Chat UI** → wire engine → `/api/book` (price + submit). Show the price breakdown in `Summary`.
6. **OCR** (infer country/product from the doc), then **ElevenLabs voice** on the same engine.
7. Other personas: **Robert** (Power of Attorney → `proofOfRepresentation` + multi-participant) and **Elizabeth** (Austrian FlexCo → `destinationCountry: "AT"`, AT timeslot label, business billing).

## 8 · Human-review zone (don't fully trust the AI here)

- The **payload assembly** (field names must match exactly)
- The **5 notarity calls** + multipart submit
- The **condition evaluation** + price summing (cents → euros)

<aside>
🟢

Vibecode freely: UI, styling, glue code, the OCR wrapper, boilerplate.

</aside>

## 9 · Don't

- Don't compute the price yourself — use POST /price and sum `net` (cents → euros)
- Don't rename payload fields or invent new ones — match notarity's keys exactly
- Don't hardcode product ids, tag ids, timeslot labels, or the question flow — read them from the form schema
- Don't skip the timeslot lookup — you must submit a real timeslot **id** from call #3 (we pick a slot, we don't build a calendar)
- Don't flip `mode` off `"debug"` or email real people while testing — use the draft id / your own address
- Don't deploy to production · don't build the admin config editor · don't gold-plate CSS
- Don't commit secrets, API keys, or persona PII

## 10 · Reference handling (the borrowed build)

<aside>
🔍

- `formless/` = **our repo** — the only thing we submit. Everything in here is written by us.
- `notarity-booking-flow/` = a build by another participant (now on a different track), kept as a **read-only reference OUTSIDE** `formless/`.
- **Reference, never source:** open `notarity-booking-flow` in a **separate Cursor window** so it's never indexed into `formless`. Read it, understand it, then rebuild the idea in `formless` in our own code. **No copy-paste, no imports from it.**
- It is **never committed** to `formless` and never appears in our git history or the MIT submission.
- **Verify before trusting:** it predates our real-payload work, so only borrow an approach after it survives the €580 contract-check — assume its field names / price logic may be the old wrong guesses.
</aside>