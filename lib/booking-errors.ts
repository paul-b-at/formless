import { ZodError } from "zod";

export type ZodIssueDetail = {
  path: string;
  message: string;
};

export type BookingErrorDetails =
  | { kind: "zod"; issues: ZodIssueDetail[] }
  | { kind: "notarity"; status: number; statusText: string; body: string };

export function formatZodIssues(error: ZodError): ZodIssueDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

export function parseNotaritySubmitError(
  message: string,
): { status: number; statusText: string; body: string } | null {
  const match = message.match(/^Notarity submit error (\d+) ([^:]+): ([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return {
    status: Number(match[1]),
    statusText: match[2]!.trim(),
    body: match[3]!,
  };
}

export function bookingErrorDetailsToText(
  details: BookingErrorDetails | undefined,
): string | null {
  if (!details) {
    return null;
  }

  if (details.kind === "zod") {
    return details.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n");
  }

  return `HTTP ${details.status} ${details.statusText}\n\n${details.body}`;
}
