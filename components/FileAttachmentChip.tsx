"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, File01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

export function truncateFilename(name: string, maxLength = 32): string {
  if (name.length <= maxLength) {
    return name;
  }

  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const budget = maxLength - extension.length - 1;

  if (budget <= 2) {
    return `${name.slice(0, maxLength - 1)}…`;
  }

  const head = Math.ceil(budget * 0.45);
  const tail = budget - head;
  return `${base.slice(0, head)}…${base.slice(-tail)}${extension}`;
}

function formatFileSize(bytes?: number): string | null {
  if (bytes === undefined || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseAttachmentFilename(content: string): string | null {
  const trimmed = content.trim();
  const uploaded = trimmed.match(/^Uploaded\s+(.+)$/i);
  if (uploaded?.[1]) {
    return uploaded[1].trim();
  }

  if (
    /\.(pdf|png|jpe?g|webp)$/i.test(trimmed) &&
    !trimmed.includes("\n") &&
    trimmed.length < 120
  ) {
    return trimmed;
  }

  return null;
}

type FileAttachmentChipProps = {
  filename: string;
  sizeBytes?: number;
  className?: string;
  variant?: "user" | "default";
  onRemove?: () => void;
  removeDisabled?: boolean;
};

export function FileAttachmentChip({
  filename,
  sizeBytes,
  className,
  variant = "default",
  onRemove,
  removeDisabled = false,
}: FileAttachmentChipProps): React.ReactElement {
  const sizeLabel = formatFileSize(sizeBytes);
  const isPdf = filename.toLowerCase().endsWith(".pdf");

  return (
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm",
        variant === "user"
          ? "border-border bg-card text-foreground"
          : "border-primary/15 bg-primary/5 text-foreground",
        className,
      )}
      title={filename}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          "bg-primary/10 text-primary",
        )}
        aria-hidden
      >
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{truncateFilename(filename)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {isPdf ? "PDF document" : "Attachment"}
          {sizeLabel ? ` · ${sizeLabel}` : ""}
        </p>
      </div>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          disabled={removeDisabled}
          aria-label={`Remove ${filename}`}
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

type FileAttachmentListProps = {
  filenames: string[];
  fileSizes?: Record<string, number>;
  className?: string;
  orientation?: "row" | "stack";
  onRemove?: (filename: string) => void;
  removeDisabled?: boolean;
};

export function FileAttachmentList({
  filenames,
  fileSizes,
  className,
  orientation = "stack",
  onRemove,
  removeDisabled = false,
}: FileAttachmentListProps): React.ReactElement {
  return (
    <div
      className={cn(
        orientation === "stack" ? "flex flex-col gap-2" : "flex flex-wrap gap-2",
        className,
      )}
    >
      {filenames.map((filename) => (
        <FileAttachmentChip
          key={filename}
          filename={filename}
          sizeBytes={fileSizes?.[filename]}
          onRemove={onRemove ? () => onRemove(filename) : undefined}
          removeDisabled={removeDisabled}
        />
      ))}
    </div>
  );
}
