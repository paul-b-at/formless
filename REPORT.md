# Formless — Document-first notary booking in under 3 minutes

Upload a document, answer only what the live booking form requires, and walk away with a zod-validated Notarity appointment payload — priced on the server, not guessed in the browser.

---

## Problem

Notarity's multi-page conditional booking form is a make-or-break first touchpoint. Clients arrive with a PDF and no idea which destination country, product, or add-ons they need. The native flow forces them through every visible field in schema order — country pickers, product pickers with auto-add rules, per-product file uploads, apostille toggles, participant setup, timeslots, and three party blocks (billing, contact, shipping) — before they ever see an authoritative price.

For a hackathon demo (and for real users), that friction kills conversion. The goal was to collapse the same contract into a conversational, document-aware flow without hardcoding a single country's question list.

---

## Solution overview

**Formless** is a document-first conversational assistant that:

1. Fetches the **live** booking-form schema from Notarity staging (`start-vienna-hackathon`).
2. Walks `pages → components → conditions` and asks only what is **visible and unfilled** for the current partial payload.
3. Optionally reads an uploaded PDF via Gemini OCR (or pre-saved sample responses in `fixtures/ocr/` when `OCR_MOCK=1`) to **suggest** destination country, product, and party fields — always with the human confirming before anything is applied.
4. Prices **server-side** on every material change via `POST /appointment-requests/price`.
5. Assembles a zod-validated `AppointmentRequest` and submits through `/api/book` in **`debug` mode** with the shared test draft id.

The same engine powers the web chat UI, headless replay scripts, and an MCP stdio server for agent-driven booking.

---

## How it works

### End-to-end flow

```
User uploads PDF (optional)          User answers chat / forms
         │                                      │
         ▼                                      ▼
   POST /api/ocr ─────────────►  OCR suggestions (country, product, party)
   lib/ocr-inference.ts              surfaced in Chat.tsx — user confirms
         │                                      │
         └──────────────┬───────────────────────┘
                        ▼
              POST /api/chat → lib/engine.ts
              advance(state, userMessage)
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
  form-interpreter   Gemini extract   notarity client
  nextUnfilled()     (structured JSON)  getTimeslots / priceRequest
  evaluateCondition()
         │              │              │
         └──────────────┴──────────────┘
                        ▼
              EngineStep (ask | form | fileUpload |
              participants | proofOfRepresentation | datePicker | complete)
                        │
                        ▼
              Summary.tsx — review + edit
                        │
                        ▼
              POST /api/book → zod → price → multipart submit
```

### Form interpreter (config-driven steps)

`lib/form-interpreter.ts` parses the booking-form JSON from `GET /booking-form/slug` and treats it as the single source of truth:

- **`evaluateCondition`** walks `ISDEFINED`, `INCLUDES`, `EQUAL`, `INTERSECTS`, `ISTRUE`, plus `AND` / `OR` / `NOT` trees against the in-progress `collected` payload.
- **`visibleComponents`** flattens each page's component tree, branching on `type: "condition"` nodes into `props.components` or `props.elseComponents`.
- **`nextUnfilled`** returns the first visible input component whose accessor is not yet satisfied — country picker, product picker, timeslot, hard-copy block, party forms, etc.
- **`applyAnswer`** writes answers back using Notarity's exact field names (never renamed).

Product pickers resolve against `GET /products/tags`; auto-add companion products (e.g. NIE application → NIE Personal Data) mirror the schema's rules. Timeslot labels are read from the form config based on `destinationCountry` (AT vs non-AT).

### Conversation engine

`lib/engine.ts` implements `advance(state, userMessage)`:

- Bootstraps defaults: `mode: "debug"`, `_appointmentRequestDraft`, `timezone: "Europe/Vienna"`, origin URL from the form's `_company`.
- Emits typed **`EngineStep`** variants the UI renders directly: `ask` (with options), `form` (party fields), `fileUpload` (per-product), `participants`, `proofOfRepresentation` (product toggle when multi-signer PoA), `datePicker` (timeslot fallback), or `complete`.
- Uses **Gemini structured output** (`gemini-3.5-flash`) to extract free-text answers into schema values; party forms can bypass the LLM via structured JSON from the UI.
- Refreshes price via `priceRequest` when the selection changes and attaches `lineItems` / `euroTotal` to steps for live breakdown display.

### OCR inference (suggestions, not autopilot)

`lib/ocr-inference.ts` sends the PDF to Gemini multimodal (or, when `OCR_MOCK=1`, returns a **pre-saved JSON file** from `fixtures/ocr/` that matches the uploaded filename — no Gemini call):

- Returns `destinationCountry`, `productHint`, `extracted.party` (name, address, email, etc.), and a **catalog-mapped** `suggestedProductId` via `lib/ocr-product-map.ts` (regex purpose/instrument hints matched against live product titles).
- `lib/ocr-party-prefill.ts` maps `extracted.party` onto party form **defaults** labelled **"From your document"**; email can also show a **"Suggested"** badge from remembered session input.
- `Chat.tsx` ranks country options, highlights suggested products, and runs `detectOcrContentMismatch` before the user applies suggestions — the human always confirms.

### Notarity API client

`lib/notarity.ts` (server-only) implements the five-call flow against `staging-api.notarity.com`:

| Step | Endpoint | Role |
|------|----------|------|
| 1 | `GET /booking-form/slug` | Form schema |
| 2 | `GET /products/tags` | Product definitions for pickers |
| 3 | `GET /appointment-requests/timeslots` | Available slot ids (7-day window) |
| 4 | `POST /appointment-requests/price` | Authoritative line items (cents) |
| 5 | `POST /appointment-requests` | Multipart submit (`payload` JSON + `files` PDFs) |

`sumNetToEuros` sums `net` (cents) ÷ 100 → `confirmedPrice`. No Notarity API key is required for staging.

### Chat UI

`components/Chat.tsx` drives the session:

- Hero landing → document upload or text start.
- Renders each `EngineStep` type: option chips, `CountrySearchSelect`, `ParticipantsForm` (multi-signer with **Add another signer**), `InlineFileUploadCard`, timeslot grid or date picker.
- Proof-of-representation quick replies appear after **two** participant emails on products with `showProofOfRepresentation`; single-signer flows skip straight to timeslots.
- Party forms use **Geoapify** autocomplete (`GET /api/address` proxy) when `GEOAPIFY_API_KEY` is set; manual entry works without it.
- On `complete`, hands off to `Summary.tsx` for price breakdown, inline edits (`ProductEditPanel`), and submit.

`app/page.tsx` wires Chat → Summary with a `BookingProgress` bar.

### Conditional rules (not hardcoded per country)

The question flow is **entirely config-driven**. Changing `destinationCountry` re-evaluates conditions and may reveal different product tags, apostille requirements, hard-copy options, AT-specific timeslot labels, or shipping blocks — without any `if (country === "ES")` branch in the engine. Country-specific behaviour comes from the live schema's condition trees and product catalog, which the interpreter evaluates generically.

---

## What's working vs mocked

| Area | Status | Notes |
|------|--------|-------|
| **Staging API** | ✅ Live | Schema, products, timeslots, price, submit — all hit `staging-api.notarity.com` |
| **Submit mode** | ✅ Debug | `mode: "debug"` + draft id `vfniS9nfoq8nMpRqQj7Z`; submit can still trigger emails |
| **Chat engine** | ✅ Working | Schema-driven steps, Gemini extraction, live price refresh |
| **OCR (live)** | ✅ Working | Gemini multimodal via `POST /api/ocr`; caches to `.ocr-cache/` locally or `/tmp` on Vercel |
| **OCR (pre-saved samples)** | 🔶 Optional mode | `OCR_MOCK=1` skips Gemini and returns committed JSON from `fixtures/ocr/` (one file per demo PDF) — recommended for live demos |
| **Timeslots** | ✅ Live fetch | Real slot ids from API; if fetch fails/empty, **`datePicker`** collects `YYYY-MM-DD` (verified against `/price`) |
| **Timeslot test override** | 🔶 Test-only | `TIMESLOT_FETCH_MOCK=fail` forces date fallback (replay scripts only) |
| **Address autocomplete** | ✅ Optional | Geoapify via `/api/address`; degrades to plain text inputs |
| **Price** | ✅ Always server | Never computed client-side; `/api/book` re-prices before submit |
| **MCP server** | ✅ Working | Same `advance()` engine; sessions are in-memory (lost on restart) |

**Honest mock summary:** the Notarity contract is real end-to-end. OCR sample mode and the timeslot test override are **explicit env switches** for reliable demos and CI — not silent fakes unless those vars are set.

---

## Demo personas & verified results

Headless replay scripts (`scripts/engine-replay*.ts`) exercise the engine without the UI, price against live staging at the end, and assert payload shape. Joshua, Robert, and **Two-signer PoA** assert exact euro totals.

| Persona | Document / flow | Key payload traits | Verified price |
|---------|-----------------|-------------------|----------------|
| **Joshua** | Spain NIE application + hard copy | `destinationCountry: "ES"`, NIE product + auto-added NIE Personal Data, apostille, two PDFs, separate shipping address | **€580** (`bun run contract-check`, `bun run engine-replay`) |
| **Robert** | Lithuania PoA (single signer) | `destinationCountry: "LT"`, Signature notarisation, private billing, no file upload, one participant | **€120** (`OCR_MOCK=1 bun run engine-replay-robert`) |
| **Two-signer PoA** | Lithuania PoA + attorney-in-fact | `destinationCountry: "LT"`, two participants (`client: true`), `proofOfRepresentation: true`, `hardCopy: { hardCopy: true, expressShipping: true }`, shipping address | **€250** (`OCR_MOCK=1 bun run engine-replay-twosigner`) |
| **Elizabeth** | Austrian FlexCo incorporation | `destinationCountry: "AT"`, FlexCo product + articles PDF, **business billing** (`business: true`, company name), express shipping only | Priced live; replay asserts structure, not a fixed euro assertion (`OCR_MOCK=1 bun run engine-replay-elizabeth`) |

Pre-saved OCR samples (used when `OCR_MOCK=1`): `fixtures/ocr/nie-application-demo-joshua_timms.json`, `Robert_Stevens_sample_case.json`, `elizabeth-flexco.json`. The two-signer replay resolves the PoA product title from the OCR fixture against the **live** LT catalog — no hardcoded product ids in the engine.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | **Next.js 15** (App Router, `runtime = "nodejs"` on upload/submit routes) |
| Runtime / tooling | **Bun**, **TypeScript** (strict) |
| UI | **React 19**, **Tailwind CSS 4**, **shadcn/ui** |
| Validation | **zod** — `AppointmentRequest` mirrors Notarity field names verbatim |
| LLM | **Google Gemini** (`@google/genai`) — chat extraction + multimodal OCR |
| Geocoding | **Geoapify** autocomplete (optional) |
| Agents | **MCP** stdio server (`mcp/server.ts`) over the same engine |

---

## Key decisions & tradeoffs

1. **Schema as source of truth** — No hardcoded product ids, tag ids, or country-specific question lists in the engine. Tradeoff: more interpreter complexity, but judges can swap the form config and the app still works.

2. **OCR as suggestions** — Country, product, and party hints are editable pre-fills, not silent writes. Tradeoff: one extra confirmation step, but avoids wrong auto-bookings on ambiguous documents.

3. **Server-side pricing only** — Every price shown to the user comes from `POST /price`. Tradeoff: extra latency per step, but eliminates client-side pricing bugs.

4. **`debug` + draft id** — Safe staging submits during development. Tradeoff: not production-ready; emails can still fire.

5. **`OCR_MOCK=1` for demos** — Pre-saved OCR JSON files guarantee persona results without Gemini quota risk. Tradeoff: judges uploading unknown PDFs won't get live inference unless mock is off.

6. **Timeslot date fallback** — When the timeslot API returns nothing, a `YYYY-MM-DD` string in `timeslots[]` still prices and submits (contract-probed). Tradeoff: user picks a preferred date, not a concrete slot id.

7. **Multi-signer PoA** — `ParticipantsForm` collects multiple signers; when `participants.length >= 2` on a product with `showProofOfRepresentation`, the engine asks for proof-of-representation before timeslots and writes `proofOfRepresentation: boolean` on the product row. Express hard-copy shipping is a first-class quick-reply option (`hardCopy` + `expressShipping`).

8. **Gemini for answer extraction** — Free-text chat maps to schema values via structured JSON. Tradeoff: requires `GEMINI_API_KEY`; party forms use structured UI to reduce parse failures.

---

## Known limitations

- **MCP sessions** are in-memory — no persistence across process restarts.
- **OCR product mapping** combines Gemini hints with regex→catalog title matching; ambiguous documents may need manual product selection.
- **Proof-of-representation** is only prompted when two or more participants are finalized (or when the product marks it required); single-signer Robert-style flows skip it by design.
- **Submit side effects** — even in `debug` mode, Notarity may send emails; the test draft id limits blast radius but does not eliminate it.
- **Elizabeth** replay validates payload structure and live price but does not hardcode an expected euro total in the script.

---

## What we'd do next

1. **Live OCR by default** with pre-saved sample fallback only on failure, plus more committed persona JSON files.
2. **Production hardening** — `mode: "live"`, draft-id removal, error telemetry, and persistent MCP session storage.
3. **Config portability** — prove the interpreter against a second booking-form slug without code changes.

---

## Links

| Resource | URL |
|----------|-----|
| Setup & run | [README.md](./README.md) |
| MCP tools | [mcp/README.md](./mcp/README.md) |
| Staging form (reference UI) | https://staging.notarity.com/#/book/start-vienna-hackathon/ |
| Live demo | https://formless-jade.vercel.app/ |
| Demo video | _TBD — add recording link_ |
