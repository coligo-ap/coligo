"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { isOpenNow, nextOpening } from "@/lib/merchant/opening-hours";
import { DAY_LABELS, type OpeningHours } from "@/lib/types";

/**
 * Badge "Ouvert maintenant / Fermé" calculé à la VOLÉE depuis `opening_hours`.
 * Rafraîchi toutes les 30s pour suivre les bascules de créneau.
 */
export function OpenStatusBadge({ hours }: { hours: OpeningHours }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const open = isOpenNow(hours, now);
  const next = open ? null : nextOpening(hours, now);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        open ? "bg-success-50 text-success-700" : "bg-surface-3 text-muted"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          open ? "bg-success-500" : "bg-stone-400"
        )}
      />
      {open ? (
        "Ouvert maintenant"
      ) : (
        <>
          Fermé
          {next && (
            <span className="text-subtle font-normal">
              · ouvre {DAY_LABELS[next.day].short.toLowerCase()}{" "}
              {next.slot.open}
            </span>
          )}
        </>
      )}
    </span>
  );
}
