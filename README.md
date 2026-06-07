# Formless

**Document-first notary booking in under three minutes** — upload a PDF, answer only what the live booking form requires, and walk away with a zod-validated Notarity appointment payload.

Built for **START Hack Vienna '26** (Notarity case).

## What it does

Formless is a conversational booking assistant that respects the **live** Notarity booking-form config (`start-vienna-hackathon` on staging):

1. Fetches the form schema and walks `pages → components → conditions` — asking only fields that are **visible and unfilled** for the current partial payload.
2. Optionally reads an uploaded document (Gemini multimodal OCR) to **suggest** destination country, product, and party details. Suggestions are human-in-the-loop: nothing is applied until the user confirms.
3. Prices **server-side** on every material change via `POST /appointment-requests/price` — never computed in the browser.
4. Assembles a zod-validated `AppointmentRequest` (Notarity field names verbatim) and submits through `/api/book` in **`debug` mode** with a shared test draft id.

The same engine powers the web chat UI, headless replay scripts, and an MCP stdio server.

## Setup & run

**Prerequisites:** [Bun](https://bun.sh) v1.1+

```bash
git clone https://github.com/paul-b-at/formless.git
cd formless
cp .env.example .env.local   # fill GEMINI_API_KEY (required)
bun install
bun dev                      # http://localhost:3000
bun run build                # production build (no env vars needed at build time)
```

### Environment variables

Copy [`.env.example`](.env.example) → `.env.local`. Names only in the repo — never commit real keys.

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | **Yes** | Chat engine answer extraction + live OCR |
| `NOTARITY_API_BASE` | No | Defaults to `https://staging-api.notarity.com` |
| `GEOAPIFY_API_KEY` | No | Address autocomplete in party forms (manual entry works without it) |
| `OCR_MODELS` | No | Comma-separated Gemini model fallback chain for OCR |
| `OCR_MOCK` | No | `1` → serve OCR from `fixtures/ocr/` (zero Gemini OCR calls) |

**No Notarity API key** — staging is open. Submits use `mode: "debug"` and draft id `vfniS9nfoq8nMpRqQj7Z`. Submit can still trigger emails on staging.

### Verify (no UI)

```bash
bun test
bun run contract-check                          # POST /price only → expect €580
bun run engine-replay                           # Joshua / Spain → €580
OCR_MOCK=1 bun run engine-replay-robert         # Lithuania PoA → €120
OCR_MOCK=1 bun run engine-replay-elizabeth      # Austrian FlexCo (structure + live price)
```

## Architecture

```
Browser (Chat.tsx, Summary.tsx)
  → POST /api/chat     → lib/engine.ts           — advance(), Gemini structured extraction
  → POST /api/ocr      → lib/ocr-inference.ts    — multimodal OCR or OCR_MOCK fixtures
  → POST /api/book     → zod validate, price, multipart submit
  → GET  /api/address  → Geoapify proxy (optional)

lib/form-interpreter.ts   — condition evaluation (ISDEFINED, INCLUDES, EQUAL, …), next unfilled step
lib/notarity.ts           — 5-call staging client (form, products, timeslots, price, submit)
lib/booking-schema.ts     — zod AppointmentRequest mirroring Notarity field names
mcp/server.ts             — same engine over MCP stdio (see mcp/README.md)
```

**Five-call Notarity flow:** `GET booking-form` → `GET products/tags` → `GET timeslots` → `POST price` → `POST submit` (multipart JSON + PDFs).

## What's working vs mocked

| Area | Status | Notes |
|------|--------|-------|
| **Staging API** | ✅ Live | Schema, products, timeslots, price, submit — all hit `staging-api.notarity.com` |
| **Submit mode** | ✅ Debug | `mode: "debug"` + test draft id; submit may still send emails |
| **Chat engine** | ✅ Working | Schema-driven steps, Gemini extraction, live price refresh |
| **OCR (live)** | ✅ Working | Gemini multimodal via `POST /api/ocr`; best-effort cache under `.ocr-cache/` (gitignored) or `/tmp` on Vercel |
| **OCR (fixtures)** | 🔶 Optional | `OCR_MOCK=1` serves committed `fixtures/ocr/*.json` — recommended for reliable demos |
| **Timeslots** | ✅ Live fetch | Real slot ids from API; if fetch fails or returns empty, **`datePicker`** collects `YYYY-MM-DD` (prices and submits) |
| **Address autocomplete** | ✅ Optional | Geoapify via `/api/address`; degrades to plain text inputs |
| **Price** | ✅ Always server | Never computed client-side; `/api/book` re-prices before submit |
| **MCP server** | ✅ Working | Same `advance()` engine; sessions are in-memory (lost on restart) |

## Demo personas

Headless replay scripts exercise the engine against live staging and assert payload shape. Joshua and Robert also assert exact euro totals.

| Persona | Flow | Key traits | Verified price |
|---------|------|------------|----------------|
| **Joshua** | Spain NIE application + hard copy | `destinationCountry: "ES"`, NIE + auto-added NIE Personal Data, apostille, two PDFs | **€580** (`bun run engine-replay`) |
| **Robert** | Lithuania Power of Attorney | `destinationCountry: "LT"`, Signature notarisation, private billing | **€120** (`OCR_MOCK=1 bun run engine-replay-robert`) |
| **Elizabeth** | Austrian FlexCo incorporation | `destinationCountry: "AT"`, FlexCo + articles PDF, **business billing** | Live price; replay asserts structure (`OCR_MOCK=1 bun run engine-replay-elizabeth`) |

OCR fixtures: `fixtures/ocr/nie-application-demo-joshua_timms.json`, `Robert_Stevens_sample_case.json`, `elizabeth-flexco.json`.

Staging booking form (comparison): https://staging.notarity.com/#/book/start-vienna-hackathon/

## Deployment

Deployed on **Vercel** (Next.js 15, Node.js runtime on upload/submit routes).

| Link | URL |
|------|-----|
| **Live demo** | https://formless-jade.vercel.app/ |
| **Demo video** | _TBD — add recording link_ |

Set environment variables in Vercel (Production + Preview) — all server-side, no `NEXT_PUBLIC_` prefixes. See the table above; **`OCR_MOCK=1`** is recommended for the live demo (committed persona fixtures, zero Gemini OCR calls). The chat engine still requires `GEMINI_API_KEY`.

## License

MIT — see [LICENSE](LICENSE).
