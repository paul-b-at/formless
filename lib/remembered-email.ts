import { isValidPartyEmail } from "@/components/party-form-validation";

/** First email the user entered in the conversation — reused as downstream suggestions. */
export function captureRememberedEmail(
  current: string | null,
  userMessage: string,
  structuredAnswer?: Record<string, unknown>,
): string | null {
  if (current) {
    return current;
  }

  const fromStructured = extractEmailFromStructuredAnswer(structuredAnswer);
  if (fromStructured) {
    return fromStructured;
  }

  const trimmed = userMessage.trim();
  if (trimmed && isValidPartyEmail(trimmed)) {
    return trimmed;
  }

  return null;
}

export function extractEmailFromStructuredAnswer(
  structuredAnswer?: Record<string, unknown>,
): string | null {
  if (!structuredAnswer) {
    return null;
  }

  const direct = structuredAnswer.email;
  if (typeof direct === "string" && isValidPartyEmail(direct)) {
    return direct.trim();
  }

  const participants = structuredAnswer.participants;
  if (Array.isArray(participants)) {
    for (const entry of participants) {
      if (
        entry &&
        typeof entry === "object" &&
        "email" in entry &&
        typeof (entry as { email: unknown }).email === "string"
      ) {
        const email = (entry as { email: string }).email.trim();
        if (isValidPartyEmail(email)) {
          return email;
        }
      }
    }
  }

  return null;
}

/** Debug lines for replay scripts — where a remembered email would prefill. */
export function describeRememberedEmailPrefill(
  rememberedEmail: string | null | undefined,
  targets: string[],
): string[] {
  if (!rememberedEmail) {
    return [];
  }
  return targets.map((target) => `rememberedEmail → ${target}: ${rememberedEmail}`);
}
