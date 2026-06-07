"use client";

import {
  FileAttachmentChip,
  parseAttachmentFilename,
} from "@/components/FileAttachmentChip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ChatMessageBubbleProps = {
  role: "user" | "assistant";
  content: string;
  index: number;
  attachmentSizeBytes?: number;
  innerRef?: React.Ref<HTMLDivElement>;
};

export function ChatMessageBubble({
  role,
  content,
  index,
  attachmentSizeBytes,
  innerRef,
}: ChatMessageBubbleProps): React.ReactElement {
  const isUser = role === "user";
  const attachmentName = isUser ? parseAttachmentFilename(content) : null;

  return (
    <div
      ref={innerRef}
      className={cn(
        "message-enter flex min-w-0 gap-2",
        isUser ? "flex-row-reverse justify-start" : "justify-start",
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}
    >
      {!isUser ? (
        <Avatar size="sm" className="mt-0.5 bg-primary/10">
          <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
            AI
          </AvatarFallback>
        </Avatar>
      ) : null}
      {attachmentName ? (
        <FileAttachmentChip
          filename={attachmentName}
          sizeBytes={attachmentSizeBytes}
          variant="user"
        />
      ) : (
        <div
          className={cn(
            "min-w-0 max-w-[85%] break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap shadow-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "border border-border/60 bg-card text-foreground",
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
