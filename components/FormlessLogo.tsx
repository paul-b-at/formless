import Image from "next/image";

import { cn } from "@/lib/utils";

type FormlessLogoProps = {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md";
};

export function FormlessMark({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}): React.ReactElement {
  return (
    <Image
      src="/notarity-mark.jpeg"
      alt="notarity"
      width={32}
      height={32}
      className={cn(
        "shrink-0 rounded object-contain",
        size === "sm" ? "h-7 w-7" : "h-7 w-7 sm:h-8 sm:w-8",
        className,
      )}
    />
  );
}

export function FormlessLogo({
  className,
  showWordmark = true,
  size = "md",
}: FormlessLogoProps): React.ReactElement {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <FormlessMark size={size} />
      {showWordmark ? (
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className={cn(
              "truncate font-semibold tracking-tight text-foreground",
              size === "sm" ? "text-base" : "text-xl sm:text-2xl",
            )}
          >
            formless
          </span>
          <span
            className={cn(
              "truncate text-muted-foreground",
              size === "sm" ? "text-[10px]" : "text-xs",
            )}
          >
            by notarity
          </span>
        </div>
      ) : null}
    </div>
  );
}
