"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Barre segmentée (onglets courts, filtres de période). Neuf systèmes
 * concurrents existaient, dont trois au markup identique recopié
 * (`PartnerSegmented`, `HubTabs`, `SubsTabs`).
 *
 * Bascule d'onglet = changement d'état purement CLIENT : aucun aller-retour
 * serveur, aucun `router.refresh()`. Si l'URL doit suivre, l'appelant utilise
 * `history.replaceState`.
 *
 * RTL : la piste suit l'ordre du document (`flex` sans `row-reverse`), donc
 * l'ordre logique des options est conservé en arabe.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly { key: K; label: React.ReactNode; badge?: number }[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "rounded-card-lg bg-surface-2 flex gap-[3px] p-1",
        className
      )}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-control-lg text-label-lg flex flex-1 items-center justify-center gap-1.5 p-2 font-bold transition-colors",
              on
                ? "bg-surface text-foreground"
                : "text-muted hover:text-foreground"
            )}
          >
            {o.label}
            {o.badge != null && o.badge > 0 && (
              <span
                className={cn(
                  "text-nano grid min-w-4 place-items-center rounded-full px-1 font-extrabold",
                  on
                    ? "bg-primary-600 text-on-brand"
                    : "bg-surface-3 text-muted"
                )}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
