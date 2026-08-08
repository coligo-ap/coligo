import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * État vide unifié : icône + titre + explication + action facultative.
 * Sept implémentations concurrentes existaient (`EmptyState` ×3, `EmptyColumn`,
 * `EmptyHint`, `EmptyOfflineHint`, `PartnerEmptyState`).
 *
 * Copy : une phrase, pas un paragraphe — et elle dit quoi FAIRE, pas seulement
 * que c'est vide.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Bouton ou lien d'amorçage (« Ajouter un produit »…). */
  action?: React.ReactNode;
  /** `sm` pour un état vide DANS une carte, `md` pour une page entière. */
  size?: "sm" | "md";
  className?: string;
}) {
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        className
      )}
    >
      {Icon && (
        <span
          className={cn(
            "bg-surface-2 text-subtle grid place-items-center rounded-full",
            compact ? "size-10" : "size-14"
          )}
        >
          <Icon className={compact ? "size-5" : "size-7"} aria-hidden />
        </span>
      )}
      <p
        className={cn(
          "text-foreground font-bold",
          compact ? "text-body-sm" : "text-title-sm"
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "text-muted max-w-xs leading-snug",
            compact ? "text-caption" : "text-label-lg"
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={compact ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  );
}
