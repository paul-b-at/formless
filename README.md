# Formless

Conversational notary booking — upload a document, answer a few questions, get a valid Notarity appointment payload in under three minutes.

Built for **START Hack Vienna '26** (Notarity case). The live booking-form schema is the source of truth: conditional rules, product pickers, timeslots, and pricing all come from staging — nothing is hardcoded.

**Live demo:** https://formless-jade.vercel.app/

## What it does

1. Fetches the live form schema from Notarity staging.
2. Walks `pages → components → conditions` and asks only what is visible and unfilled.
3. Optionally reads an uploaded PDF/image (OCR) to suggest country and product — user confirms before applying.
4. Prices server-side via `POST /appointment-requests/price` (never computed in the browser).
5. Assembles a zod-validated `AppointmentRequest` and submits in `debug` mode with a test draft id.

## Setup & run

**Prerequisites:** [Bun](https://bun.sh) v1.1+

```bash
git clone https://github.com/paul-b-at/formless.git
cd formless
cp .env.example .env.local   # fill GEMINI_API_KEY (see below)
bun install
bun dev                      # http://localhost:3000
```

### Environment variables

Copy `.env.example` → `.env.local`. Required and optional vars (names only — no secrets in the repo):

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes | Chat engine + live OCR |
| `NOTARITY_API_BASE` | No | Defaults to `https://staging-api.notarity.com` |
| `GEOAPIFY_API_KEY` | No | Address autocomplete in party forms |
| `OCR_MODELS` | No | Comma-separated Gemini model fallback chain for OCR |
| `OCR_MOCK` | No | `1` → serve OCR from `fixtures/ocr/` (no Gemini calls) |

**No Notarity API key** — staging is open. Keep `mode: "debug"` and the test draft id while testing; submit can send emails.

### Verify (no UI)

```bash
bun test
bun run contract-check      # POST /price only → expect €580
bun run engine-replay       # Joshua flow → €580
OCR_MOCK=1 bun run engine-replay-robert    # Lithuania PoA → €120
OCR_MOCK=1 bun run engine-replay-elizabeth # Austrian FlexCo
```

## Architecture

```
Browser (Chat.tsx)
  → POST /api/chat     → lib/engine.ts (Gemini extraction, advance())
  → POST /api/ocr      → lib/ocr-inference.ts (multimodal Gemini or OCR_MOCK fixtures)
  → POST /api/book     → zod validate, price, multipart submit
  → GET  /api/address  → Geoapify proxy (optional)

lib/form-interpreter.ts   — condition evaluation, next unfilled component, applyAnswer
lib/notarity.ts           — 5-call staging client (form, products, timeslots, price, submit)
lib/booking-schema.ts     — zod AppointmentRequest mirroring Notarity field names
mcp/server.ts             — same engine over MCP stdio (see mcp/README.md)
```

**Five-call Notarity flow:** `GET booking-form` → `GET products/tags` → `GET timeslots` → `POST price` → `POST submit` (multipart JSON + PDFs).

## What's working vs mocked

| Area | Status |
|------|--------|
| Live staging API | **Working** — reads schema, products, timeslots; prices and submits in `debug` mode |
| Chat engine | **Working** — schema-driven questions, party forms, file uploads per product |
| OCR | **Working** with Gemini; **`OCR_MOCK=1`** uses committed `fixtures/ocr/*.json` for personas (zero API calls) |
| Timeslots | **Working** — fetches real slot ids; if none match, user can send a date (`YYYY-MM-DD` fallback) |
| Address autocomplete | **Working** when `GEOAPIFY_API_KEY` is set; manual entry otherwise |
| MCP agents | **Working** — `start_booking` / `answer` / `get_price` / `submit_booking` |

## Demo personas

| Persona | Flow | Expected price | Replay |
|---------|------|----------------|--------|
| **Joshua** | Spain NIE application + hard copy | **€580** | `bun run engine-replay` |
| **Robert** | Lithuania Power of Attorney, dual signer | **€120** | `OCR_MOCK=1 bun run engine-replay-robert` |
| **Elizabeth** | Austrian FlexCo, business billing | contract-check persona | `OCR_MOCK=1 bun run engine-replay-elizabeth` |

OCR fixtures: `fixtures/ocr/` (Joshua, Robert, Elizabeth). Local dev caches may also land in `.ocr-cache/` (gitignored).

Staging booking form (comparison): https://staging.notarity.com/#/book/start-vienna-hackathon/

## Deploy to Vercel

Next.js 15 (Webpack). All API routes that handle uploads or multipart submit use **`export const runtime = "nodejs"`** (not Edge).

1. Import the repo at [vercel.com/new](https://vercel.com/new) (GitHub → `formless`).
2. Framework preset: **Next.js**. Build command: `next build` (default). Install: `bun install` or `npm install` (lockfile supports both).
3. Set **Environment Variables** (Production + Preview) — all server-side, **no `NEXT_PUBLIC_` prefixes**:

| Variable | Required on Vercel | Example / notes |
|----------|-------------------|-----------------|
| `GEMINI_API_KEY` | **Yes** | Chat engine (always uses Gemini) |
| `NOTARITY_API_BASE` | No | `https://staging-api.notarity.com` (default if unset) |
| `GEOAPIFY_API_KEY` | No | Address autocomplete; forms work without it |
| `OCR_MODELS` | No | e.g. `gemini-2.5-flash,gemini-2.0-flash` |
| `OCR_MOCK` | No | **`1` recommended** for the live demo (see below) |

4. Deploy. Smoke-test: open `/`, start chat, upload a demo PDF. Current deployment: https://formless-jade.vercel.app/

**OCR for the live demo:** set **`OCR_MOCK=1`** on Vercel. OCR then serves committed `fixtures/ocr/*.json` (Joshua / Robert / Elizabeth personas) with zero Gemini OCR calls — reliable for judges and no quota surprises. The chat engine still needs `GEMINI_API_KEY`. For live multimodal OCR instead, set `OCR_MOCK=0` (or unset) and ensure `OCR_MODELS` + quota are healthy; live OCR writes a best-effort cache under `/tmp` on Vercel and never fails the request if the write fails.

**Local vs Vercel:** `bun run build` needs no env vars at build time. Secrets are read at runtime in `app/api/*` only.

## License

MIT — see [LICENSE](LICENSE).
