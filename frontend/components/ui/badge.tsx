import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-surface-0",
      secondary: "border-transparent bg-surface-3 text-foreground",
      outline: "border-surface-3 text-muted",
      danger: "border-danger/50 text-danger"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ className, variant }))} data-slot="badge" {...props} />;
}

export { Badge, badgeVariants };
