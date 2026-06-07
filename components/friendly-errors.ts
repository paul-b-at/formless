const RAW_PATTERNS = [
  /zod/i,
  /validation/i,
  /unexpected token/i,
  /json/i,
  /fetch failed/i,
  /network/i,
  /ECONNREFUSED/i,
];

export function friendlyErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (!message) {
    return fallback;
  }

  if (RAW_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }

  if (message.length > 140) {
    return fallback;
  }

  return message;
}
