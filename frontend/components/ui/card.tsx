import * as React from "react";
import { cn } from "../../lib/utils";

type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
};

const Card = React.forwardRef<HTMLElement, CardProps>(
  ({ as: Comp = "div", className, ...props }, ref) => (
    <Comp
      className={cn("rounded-lg border border-surface-3 bg-surface-2 text-foreground", className)}
      data-slot="card"
      ref={ref}
      {...props}
    />
  )
);
Card.displayName = "Card";

type CardContentProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
};

const CardContent = React.forwardRef<HTMLElement, CardContentProps>(
  ({ as: Comp = "div", className, ...props }, ref) => (
    <Comp className={cn("p-3", className)} data-slot="card-content" ref={ref} {...props} />
  )
);
CardContent.displayName = "CardContent";

export { Card, CardContent };
