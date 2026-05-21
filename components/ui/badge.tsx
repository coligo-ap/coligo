import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        primary: "bg-primary-50 text-primary-700",
        success: "bg-success-100 text-success-700",
        warning: "bg-warning-100 text-warning-700",
        danger: "bg-danger-100 text-danger-700",
        neutral: "bg-surface-3 text-muted",
        // anciens noms pour compat
        amber: "bg-warning-100 text-warning-700",
        teal: "bg-primary-50 text-primary-700",
        green: "bg-success-100 text-success-700",
        rose: "bg-danger-100 text-danger-700",
        stone: "bg-surface-3 text-muted",
        blue: "bg-primary-50 text-primary-700",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
