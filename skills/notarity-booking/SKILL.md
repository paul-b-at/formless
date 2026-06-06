---
name: notarity-booking
description: Use this skill when booking a Notarity appointment through the MCP booking tools.
---

# Notarity Booking

Use the Notarity MCP booking tools to run the booking flow through Formless.

1. Start with `start_booking`.
2. Use `answer` repeatedly with the returned `sessionId` until the engine says the booking payload is complete.
3. Call `get_price` before any submit. For the debug Joshua/Spain flow, the expected price is `€580`.
4. Never call `submit_booking` unless the user explicitly confirms they want to submit.
5. When submitting, call `submit_booking({ sessionId, confirm: true })`. If the user has not confirmed, do not submit.

Be careful with personal data. Do not expose secrets, API keys, `.env.local`, or hidden environment values in conversation or tool output.
