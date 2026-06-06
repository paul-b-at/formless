# Formless Notarity MCP Server

This MCP server exposes the existing Formless Notarity booking flow as stdio tools for agents. It uses the repo's booking engine and Notarity API helpers instead of duplicating booking or pricing logic.

The default booking form slug is `start-vienna-hackathon`. Sessions are stored in memory with `Map<sessionId, EngineState>`, which is enough for hackathon/debug use.

## Requirements

- `bun install`
- `.env.local` with server-side values:
  - `GEMINI_API_KEY`
  - `NOTARITY_API_BASE`

Do not commit `.env.local` or print secret values.

## Run

```bash
bun run mcp/server.ts
```

All diagnostics go to stderr. stdout is reserved for MCP JSON-RPC.

TODO: add a root `mcp` script later, for example `bun run mcp`, when the parallel-safety restriction on editing `package.json` is lifted.

## Tools

1. `start_booking({ slug? })`
   - Loads the booking form, bootstraps an engine state, creates a `sessionId`, and returns the first assistant question plus a structured state summary.

2. `answer({ sessionId, userMessage })`
   - Sends the user's answer into the existing engine, stores the updated state, and returns the assistant message, collected fields, missing fields, and completion status.

3. `get_price({ sessionId })`
   - Uses the current collected payload and the existing Notarity pricing helper. Price comes from the Notarity API; the server does not invent pricing rules.

4. `submit_booking({ sessionId, confirm })`
   - Submits only when `confirm === true`.
   - Forces `mode: "debug"` while testing.
   - Uses the existing safe draft id when the engine has added it.
   - Attaches local files from `notarity-reference/` when product file names are present in the collected payload.

Submit can send real emails. Keep debug mode while testing.

## Example Sequence

```text
start_booking({})
answer({ sessionId, userMessage: "ES" })
answer({ sessionId, userMessage: "NIE number application" })
answer({ sessionId, userMessage: "nie-application-demo-joshua_timms.pdf" })
answer({ sessionId, userMessage: "nie_personal_details.pdf" })
answer({ sessionId, userMessage: "joshua.timms@notarity.com" })
answer({ sessionId, userMessage: "<timeslot id from options>" })
answer({ sessionId, userMessage: "<billing JSON>" })
answer({ sessionId, userMessage: "yes hard copy please" })
answer({ sessionId, userMessage: "<shipping JSON>" })
get_price({ sessionId })
submit_booking({ sessionId, confirm: true })
```

For the Joshua/Spain debug flow, `get_price` should return `€580` before submit.

## Claude Code Registration

From the repo root:

```bash
claude mcp add formless-notarity -- bun run mcp/server.ts
```

Then restart Claude Code or reload MCP servers.

## Cursor Registration

Add this to your Cursor MCP config:

```json
{
  "mcpServers": {
    "formless-notarity": {
      "command": "bun",
      "args": ["run", "mcp/server.ts"],
      "cwd": "/Users/hayatoener/formless"
    }
  }
}
```

Restart Cursor or reload MCP servers after saving the config.

## TODOs

- Add a root `mcp` package script once edits outside `mcp/` and `skills/` are allowed again.
