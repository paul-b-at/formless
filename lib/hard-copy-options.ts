export type HardCopySelection = {
  hardCopy: boolean;
  expressShipping: boolean;
};

export const HARD_COPY_OPTIONS = [
  "Yes, send a hard copy with express shipping",
  "Yes, send a hard copy",
  "No hard copy needed",
] as const;

export function parseHardCopyAnswer(message: string): HardCopySelection | undefined {
  const lower = message.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }

  if (/express shipping only/i.test(lower)) {
    return { hardCopy: false, expressShipping: true };
  }
  if (
    /hard copy with express|express.*hard copy|yes.*hard copy.*express|hard copy.*express shipping/i.test(
      lower,
    )
  ) {
    return { hardCopy: true, expressShipping: true };
  }
  if (
    lower === "no hard copy needed" ||
    /^(no|without)\b/.test(lower) ||
    /\bnot needed\b/.test(lower)
  ) {
    return { hardCopy: false, expressShipping: false };
  }
  if (/yes|send a hard copy|true/i.test(lower)) {
    return { hardCopy: true, expressShipping: false };
  }

  return undefined;
}
