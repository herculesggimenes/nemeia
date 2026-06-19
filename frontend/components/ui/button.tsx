"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-surface-0 hover:bg-[#b4befe]",
        destructive: "border border-red-300/35 bg-red-600 text-white shadow-sm hover:bg-red-500",
        outline: "border border-surface-3 bg-surface-2 text-foreground hover:bg-surface-3",
        ghost: "text-muted hover:bg-surface-3 hover:text-foreground",
        tab: "border border-transparent text-muted hover:bg-surface-3 hover:text-foreground",
        activeTab: "border border-surface-3 bg-surface-3 text-foreground",
        icon: "text-muted hover:bg-surface-3 hover:text-foreground"
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2 text-xs",
        icon: "size-7",
        iconSm: "size-[18px]"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, type = "button", variant, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ className, size, variant }))}
        ref={ref}
        type={asChild ? undefined : type}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
