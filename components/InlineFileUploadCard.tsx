"use client";

import { useRef, useState } from "react";

import { FileAttachmentChip } from "@/components/FileAttachmentChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,.pdf";

export type UploadContentWarning = {
  message: string;
  detectedProductTitle?: string;
};

type InlineFileUploadCardProps = {
  productLabel: string;
  loading: boolean;
  checking?: boolean;
  selectedFile: File | null;
  hardError?: string | null;
  contentWarning?: UploadContentWarning | null;
  onFile: (file: File) => void;
  onUseAnyway?: () => void;
  onReplace?: () => void;
};

export function InlineFileUploadCard({
  productLabel,
  loading,
  checking = false,
  selectedFile,
  hardError = null,
  contentWarning = null,
  onFile,
  onUseAnyway,
  onReplace,
}: InlineFileUploadCardProps): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = loading || checking;

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || busy) {
      return;
    }
    onFile(file);
  };

  const openPicker = () => {
    if (!busy) {
      inputRef.current?.click();
    }
  };

  const showDropZone = !selectedFile && !checking;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
      <p className="text-sm font-medium">
        Attach document for {productLabel}
      </p>

      {hardError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          {hardError}
        </div>
      ) : null}

      {contentWarning ? (
        <div
          role="status"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-foreground"
        >
          <p>{contentWarning.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                onReplace?.();
                openPicker();
              }}
            >
              Replace file
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => onUseAnyway?.()}
            >
              Use anyway
            </Button>
          </div>
        </div>
      ) : null}

      {checking ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-border/80 bg-background/60 px-4 py-5 text-center">
          <p className="text-sm text-muted-foreground">Checking your document…</p>
        </div>
      ) : null}

      {selectedFile && !checking ? (
        <div className="flex min-w-0 flex-col gap-2">
          <FileAttachmentChip
            filename={selectedFile.name}
            sizeBytes={selectedFile.size}
          />
          {!contentWarning ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto w-fit px-0 text-primary"
              disabled={busy}
              onClick={openPicker}
            >
              Replace
            </Button>
          ) : null}
        </div>
      ) : null}

      {showDropZone ? (
        <div
          className={cn(
            "flex min-w-0 flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors motion-reduce:transition-none",
            dragOver
              ? "border-primary/50 bg-primary/10 shadow-sm"
              : "border-border/80 bg-background/60",
            busy && "pointer-events-none opacity-60",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) {
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            handleFiles(event.dataTransfer.files);
          }}
        >
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={openPicker}
          >
            Choose file
          </Button>
          <p className="text-xs text-muted-foreground">
            PDF only · drag &amp; drop or click to browse (max 10 MB)
          </p>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={busy}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
