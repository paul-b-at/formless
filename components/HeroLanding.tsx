"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type HeroLandingProps = {
  className?: string;
  loading?: boolean;
};

const TRUST_CUES = [
  "Live form schema — no hardcoded flows",
  "Server-priced before you book",
  "Debug mode — no real emails",
] as const;

export function HeroLanding({
  className,
  loading = false,
}: HeroLandingProps): React.ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-border/70 bg-gradient-to-b from-primary/5 to-transparent px-4 py-8 text-center motion-reduce:bg-none",
        className,
      )}
      aria-label="Welcome"
    >
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          Book a notary appointment in under 3 minutes
        </h2>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          Upload a document or type your answer — we&apos;ll ask only what the
          live booking form requires and price it on the server.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground" role="status">
          Warming up your assistant…
        </p>
      ) : (
        <p className="text-xs font-medium text-primary">
          Drop a PDF below or start typing in the chat
        </p>
      )}

      <ul className="flex flex-wrap items-center justify-center gap-2">
        {TRUST_CUES.map((cue) => (
          <li key={cue}>
            <Badge
              variant="secondary"
              className="bg-primary/8 text-xs font-normal text-foreground"
            >
              {cue}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
