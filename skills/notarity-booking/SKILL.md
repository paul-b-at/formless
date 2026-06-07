---
name: notarity-booking
description: Use this skill when booking a Notarity appointment through the MCP booking tools.
---

# Notarity Booking

Use the Notarity MCP booking tools to run the booking flow through Formless (`bun run mcp`).

1. Start with `start_booking`.
2. Use `answer` repeatedly with the returned `sessionId` until `structuredContent.step.type === "complete"`.
3. **File uploads:** when `step.type === "fileUpload"`, call `answer` with `uploadKind: "file"`, `uploadProductId` from the step, and `userMessage` set to the PDF filename. Each product needs its **own** file — never reuse the application PDF for NIE Personal Data.
4. **Never** send a filename on an email or party step — the engine rejects it; use a real email address.
5. Call `get_price` before any submit. Joshua/Spain debug flow → **€580**.
6. Call `submit_booking({ sessionId, confirm: false })` for a dry-run preview (payload + price, no submit).
7. Only call `submit_booking({ sessionId, confirm: true })` after the user **explicitly** confirms submission.

Read `structuredContent.step`, not only the human `content` text, especially for `fileUpload` and `form` steps.

Be careful with personal data. Do not expose secrets, API keys, `.env.local`, or hidden environment values.
