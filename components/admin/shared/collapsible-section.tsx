"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Section REPLIABLE des fiches admin (accordéon natif <details> : accessible,
 * léger). En-tête = icône + titre + compteur, chevron qui pivote. L'état est
 * PILOTÉ : un router.refresh (après une action) re-rend la fiche — sans ça,
 * une section dépliée par l'admin se refermerait sur sa valeur par défaut.
 *
 * `icon` est un ÉLÉMENT (ex. <Wallet className="size-4" />), jamais un
 * composant-fonction : les fiches SERVEUR le passent en prop → il doit être
 * sérialisable (cf. piège fonctions en props RSC).
 */
export function CollapsibleSection({
  icon,
  title,
  count,
  hint,
  defaultOpen = false,
  tone,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  count?: number;
  hint?: string;
  defaultOpen?: boolean;
  /** `danger` : liseré rouge (sanctions) pour attirer l'œil. */
  tone?: "danger";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={cn(
        "group bg-surface mt-4 rounded-lg border p-4",
        tone === "danger" ? "border-danger-200" : "border-border"
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
        {icon && (
          <span
            className={cn(
              "inline-flex",
              tone === "danger" && "text-danger-600"
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
        {title}
        {typeof count === "number" && (
          <span
            className={cn(
              "text-caption rounded-full px-2 py-0.5 font-bold tabular-nums",
              tone === "danger"
                ? "bg-danger-100 text-danger-700"
                : "bg-surface-2 text-muted"
            )}
          >
            {count}
          </span>
        )}
        <ChevronDown className="text-muted ms-auto size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      {hint && <p className="text-muted text-body-sm mt-1">{hint}</p>}
      {children}
    </details>
  );
}
