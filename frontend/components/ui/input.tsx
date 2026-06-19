import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-surface-3 bg-surface-2 px-3 text-sm text-foreground outline-none placeholder:text-muted focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      data-slot="input"
      ref={ref}
      type={type}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
