# Formless

AI booking assistant that turns a notarity appointment into a short conversation — built for the **START Hack Vienna '26** case from **Notarity**.

A submission for **START Hack Vienna '26**, built for the case provided by **Notarity**.

---

## About

Notarity's booking flow is powerful but form-heavy: clients must pick products, upload documents, choose timeslots, and fill billing details against a conditional schema they often don't understand. **Formless** reads the live booking-form schema from the Notarity API, asks only what's required, assembles a valid `AppointmentRequest` payload, prices it server-side, and submits — all through a text chat in under three minutes.

## The challenge

Notarity challenged us to **reimagine the booking form**. The raw material is a declarative, page-based schema (country pickers, product pickers, conditions, timeslots) and a strict multipart submit contract. Our goal: a generic interpreter that works when judges swap the config — no hardcoded product lists or question flows.

## What we built

- **Schema-driven form interpreter** — walks `pages[] → components[] → conditions` from the live booking form; supports `ISDEFINED`, `INCLUDES`, `EQUAL`, `INTERSECTS`, `ISTRUE`, and auto-add rules (e.g. NIE application → NIE Personal Data)
- **Gemini conversation engine** — extracts answers with structured output, validates through zod, applies smart defaults, and calls `/price` whenever the selection changes
- **Server-only Notarity client** — the full 5-call flow (form → products → timeslots → price → submit)
- **Text chat UI** — quick-reply buttons, PDF upload, live price breakdown, and one-click submit in debug mode

## Demo

- Live demo: run locally (see below)
- Reference flow: Joshua/Spain NIE application — €580 (verified by `contract-check` and `engine-replay`)

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A **Gemini API key** (`GEMINI_API_KEY`) for the conversation engine
- Optional: Notarity staging access (defaults to `https://staging-api.notarity.com`)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/paul-b-at/formless.git
cd formless

# 2. Configure environment
cp .env.example .env.local
# fill in GEMINI_API_KEY (required for chat)
# NOTARITY_API_BASE is optional — defaults to staging

# 3. Install dependencies
bun install
```

### Run

```bash
bun dev
```

Then open **http://localhost:3000** in your browser.

### Verify (no UI)

```bash
bun test                              # form-interpreter unit tests
bun run scripts/contract-check.ts     # price Joshua payload → €580
bun run scripts/engine-replay.ts      # engine reproduces Joshua flow end-to-end
```

### Joshua demo flow (browser)

1. Type **`ES`** when asked for destination country
2. Select **NIE number application** (type or quick-reply)
3. Upload **`nie-application-demo-joshua_timms.pdf`** and **`nie_personal_details.pdf`** from `notarity-reference/`
4. Enter **`joshua.timms@notarity.com`** for participants
5. Pick a **timeslot** quick-reply
6. Paste **billing** and **shipping** JSON (see `notarity-reference/submit-appointment-request.js`)
7. Confirm **`same as billing`** and **`yes hard copy please`**
8. Review **€580** in Summary → click **Book it** (debug mode + draft id)

---

## Project structure

```
app/
  page.tsx              # chat UI entry
  api/
    chat/route.ts       # engine turn handler (LLM)
    book/route.ts       # validate, price, submit to Notarity
    ocr/route.ts        # stub — doc upload (not yet implemented)
components/
  Chat.tsx              # message list, input, quick replies
  Summary.tsx           # price breakdown + Book it
  VoiceButton.tsx       # stub — ElevenLabs (not yet implemented)
lib/
  booking-schema.ts     # zod AppointmentRequest (mirrors Notarity payload)
  notarity-api.ts       # staging API client (5 calls)
  notarity.ts           # server-only re-export
  form-interpreter.ts   # schema walk + condition evaluation
  engine.ts             # Gemini conversation brain
scripts/
  contract-check.ts     # prove /price against known-good payload
  engine-replay.ts      # prove engine reproduces Joshua flow
notarity-reference/     # Notarity's reference scripts + demo PDFs (read-only)
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (chat) | Google Gemini API key for answer extraction |
| `NOTARITY_API_BASE` | No | Defaults to `https://staging-api.notarity.com` |
| `ELEVENLABS_API_KEY` | No | Reserved for voice (not yet implemented) |

**Never commit secrets** — keep them in `.env.local` (git-ignored). See `.env.example`.

⚠️ Submit sends real emails. Keep `mode: "debug"` and reuse the test draft id (`vfniS9nfoq8nMpRqQj7Z`) while testing.

## Architecture & assumptions

The **live booking-form schema** (GET `/booking-form/slug`) is the source of truth — not a hardcoded question list. The form interpreter decides what's visible and unfilled; the engine uses Gemini to parse natural-language answers into typed values, always validated with zod before merging. All Notarity and Gemini calls run server-side in `app/api/*`. Price is never computed client-side: we POST `/appointment-requests/price` and sum `net` (cents) ÷ 100.

## Troubleshooting

- **Chat returns 500** → check `GEMINI_API_KEY` in `.env.local`
- **€580 mismatch** → run `bun run scripts/contract-check.ts` to isolate the Notarity client
- **Book it fails on files** → `products[].files` names must exactly match uploaded PDF filenames
- **No timeslots** → staging date window is max 8 days; pick a slot from quick-replies

---

## Team

**Formless** — START Hack Vienna '26

## Submission

- Track: **START Hack Vienna '26** · Case partner: **Notarity**
- Submitted to the START Hack Vienna '26 GitHub organisation.

## License

Released under the MIT License — see [`LICENSE`](LICENSE).
