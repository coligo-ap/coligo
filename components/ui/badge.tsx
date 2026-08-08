import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full whitespace-nowrap",
  {
    variants: {
      tone: {
        primary: "bg-primary-50 text-primary-700",
        success: "bg-success-100 text-success-700",
        warning: "bg-warning-100 text-warning-700",
        danger: "bg-danger-100 text-danger-700",
        info: "bg-info-100 text-info-700",
        neutral: "bg-surface-3 text-muted",
        // Variantes PÂLES (fond -50) : pastilles posées sur une carte déjà
        // teintée, où le -100 serait trop appuyé.
        successSoft: "bg-success-50 text-success-700",
        warningSoft: "bg-warning-50 text-warning-700",
        dangerSoft: "bg-danger-50 text-danger-700",
        // anciens noms pour compat
        amber: "bg-warning-100 text-warning-700",
        teal: "bg-primary-50 text-primary-700",
        green: "bg-success-100 text-success-700",
        rose: "bg-danger-100 text-danger-700",
        stone: "bg-surface-3 text-muted",
        blue: "bg-primary-50 text-primary-700",
      },
      size: {
        sm: "px-2 py-0.5 text-caption font-semibold",
        md: "px-2.5 py-0.5 text-xs font-medium",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  }
);

export interface BadgeProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props} />
  );
}
