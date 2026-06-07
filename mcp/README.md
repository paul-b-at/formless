# Formless Notarity MCP Server

Stdio MCP tools over the **same** Formless stack as the web app:

- **Engine:** `advance()` in `lib/engine.ts` (form walk, Gemini extraction, zod merge, `/price` refresh)
- **Interpreter:** `parseBookingForm`, `nextUnfilled`, `applyAnswer`, `evaluateCondition` in `lib/form-interpreter.ts`
- **Notarity client:** `getBookingForm`, `priceRequest`, `submitRequest`, `sumNetToEuros` in `lib/notarity.ts`

No duplicated condition evaluation or price logic lives in `mcp/` — only thin session wiring in `mcp/booking-session.ts`.

Default booking form slug: `start-vienna-hackathon`. Sessions are **in-memory** (`Map<sessionId, EngineState>`); restarting the process loses state.

## Requirements

- `bun install`
- `.env.local` with `GEMINI_API_KEY` (and optional `NOTARITY_API_BASE`)
- Demo PDFs in `notarity-reference/` for `submit_booking` (not needed for `get_price` / replay pricing)

Do not commit `.env.local` or print secret values. **No Notarity API key** is required for staging.

## Run

```bash
bun run mcp
# equivalent: bun run mcp/server.ts
```

Diagnostics go to **stderr**. stdout is reserved for MCP JSON-RPC.

Verify the adapter without an MCP client:

```bash
bun run mcp-replay
```

## Tools

### `start_booking({ slug? })`

Loads the live form via `getBookingForm` → `parseBookingForm`, bootstraps `EngineState`, calls `advance(state, "")`, returns `sessionId` + `structuredContent.step`.

### `answer({ sessionId, userMessage, uploadProductId?, uploadKind? })`

Calls `advance()` with the stored session state.

**Per-product files (Hotfix #5):** when `step.type === "fileUpload"`, pass:

```json
{
  "uploadKind": "file",
  "uploadProductId": "<productId from step>",
  "userMessage": "nie_personal_details.pdf"
}
```

This binds the filename only to that product's `products[i].files`. Filenames sent on email/party/text steps are **rejected** by the engine (re-ask).

**Intentional limits:**

- Text + optional `uploadKind`/`uploadProductId` only — no `structuredAnswer` for inline party forms (agents answer billing/shipping as natural language or JSON strings parsed by Gemini).
- Prefer `structuredContent.step` over human `content` text for `fileUpload` / `form` steps.

### `get_price({ sessionId })`

Validates collected state with zod, then `priceRequest()` + `sumNetToEuros()`. Joshua/Spain → **€580**.

### `submit_booking({ sessionId, confirm })`

| `confirm` | Behaviour |
|-----------|-----------|
| `false` | **Dry-run preview** — parsed payload + line items + price. **No submit.** |
| `true` | Submits via `submitRequest()` with `mode: "debug"`, draft id `vfniS9nfoq8nMpRqQj7Z`, PDF bytes from `notarity-reference/<filename>`. |

Submit can send real emails even in debug — only call `confirm: true` after explicit user approval.

## Example sequence

```text
start_booking({})
answer({ sessionId, userMessage: "ES" })
answer({ sessionId, userMessage: "NIE number application" })
answer({ sessionId, userMessage: "nie-application-demo-joshua_timms.pdf", uploadKind: "file", uploadProductId: "UpEJ7raQEKQKFhWn12r2" })
answer({ sessionId, userMessage: "nie_personal_details.pdf", uploadKind: "file", uploadProductId: "xK5IkgPX1LTYdWLFzW8X" })
answer({ sessionId, userMessage: "joshua.timms@notarity.com" })
answer({ sessionId, userMessage: "<timeslot id from step.options>" })
answer({ sessionId, userMessage: "<billing as text or JSON>" })
answer({ sessionId, userMessage: "yes hard copy please" })
answer({ sessionId, userMessage: "<shipping as text or JSON>" })
get_price({ sessionId })
submit_booking({ sessionId, confirm: false })   # dry-run preview
submit_booking({ sessionId, confirm: true })    # only after user confirms
```

## Registration

**Claude Code** (repo root):

```bash
claude mcp add formless-notarity -- bun run mcp
```

**Cursor** — set `cwd` to your clone:

```json
{
  "mcpServers": {
    "formless-notarity": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/formless"
    }
  }
}
```

Agent skill: `skills/notarity-booking/SKILL.md`.
