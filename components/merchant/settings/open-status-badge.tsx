"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { type OpeningHours } from "@/lib/types";

/**
 * Badge "Ouvert maintenant / Fermé" calculé à la VOLÉE depuis `opening_hours`.
 * Rafraîchi toutes les 30s pour suivre les bascules de créneau. Localisé FR/AR.
 */
export function OpenStatusBadge({ hours }: { hours: OpeningHours }) {
  const t = useTranslations("listing");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const open = isOpenNow(hours, now);

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
      {open ? t("openNow") : t("closed")}
    </span>
  );
}
