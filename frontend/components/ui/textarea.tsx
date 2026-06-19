import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "min-h-16 w-full resize-none rounded-md border border-surface-4 bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      data-slot="textarea"
      ref={ref}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";

export { Textarea };
