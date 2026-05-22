"use client";

import { useState } from "react";
import { cn, formatDA } from "@/lib/utils";
import type { Bucket } from "@/lib/stats";

/**
 * Graphique d'évolution du CA — version légère maison (aucune dépendance).
 * Barres responsives + tooltip au survol/au toucher. Scroll horizontal quand
 * il y a beaucoup de tranches (30 jours / 12 mois).
 */
export function RevenueChart({ data }: { data: Bucket[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.ca));
  const many = data.length > 14;
  // Afficher ~6 étiquettes max pour ne pas surcharger l'axe.
  const labelStep = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: many ? data.length * 34 : undefined }}>
        {/* Barres */}
        <div className="flex h-[200px] items-end gap-1">
          {data.map((d, i) => {
            const h = (d.ca / max) * 100;
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive((a) => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                className="group relative flex flex-1 flex-col justify-end self-stretch outline-none"
                aria-label={`${d.label} : ${formatDA(d.ca)}`}
              >
                {active === i && (
                  <span className="border-border pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-[10px] border bg-white px-2.5 py-1.5 text-center whitespace-nowrap shadow-md">
                    <span className="text-muted block text-[10px]">
                      {d.label}
                    </span>
                    <span className="text-foreground block text-xs font-semibold tabular-nums">
                      {formatDA(d.ca)}
                    </span>
                  </span>
                )}
                <span
                  className={cn(
                    "mx-auto w-full max-w-[26px] rounded-t-[4px] transition-colors",
                    active === i ? "bg-primary-600" : "bg-primary-500/70"
                  )}
                  style={{ height: `${h}%`, minHeight: d.ca > 0 ? 3 : 1 }}
                />
              </button>
            );
          })}
        </div>

        {/* Axe X (étiquettes espacées) */}
        <div className="text-subtle mt-2 flex gap-1 text-[10px]">
          {data.map((d, i) => (
            <span key={i} className="flex-1 text-center">
              {i % labelStep === 0 ? d.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
