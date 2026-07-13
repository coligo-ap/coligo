"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, ChevronRight, Clock, ShieldAlert } from "lucide-react";
import { fetchIdvCompliance } from "@/app/idv/actions";
import type { IdvCompliance } from "@/lib/idv/compliance";
import { IdvScope } from "./idv-theme";

// =============================================================================
// IDV — bannière d'appel à vérification, variante CLIENT (compte chauffeur,
// rendu côté client par choix de perf). Elle charge son état après le montage
// et NE RÉSERVE AUCUNE PLACE tant qu'elle n'a rien à dire : pas de saut de
// mise en page pour une ligne qui, le plus souvent, n'existera pas.
// Le jumeau serveur est components/idv/idv-callout.tsx.
// =============================================================================

export function IdvCalloutClient({
  profile,
}: {
  profile: "driver" | "chauffeur" | "merchant";
}) {
  const [c, setC] = useState<IdvCompliance | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchIdvCompliance(profile).then((res) => {
      if (alive) setC(res);
    });
    return () => {
      alive = false;
    };
  }, [profile]);

  if (!c || !c.enabled) return null;

  if (c.verified) {
    return (
      <IdvScope
        className="mb-3 flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--idv-card)",
          border: "1px solid var(--idv-line)",
        }}
      >
        <BadgeCheck
          className="size-5 shrink-0"
          style={{ color: "var(--idv-ok)" }}
        />
        <p className="text-sm font-medium">Identité vérifiée</p>
      </IdvScope>
    );
  }

  if (c.inProgress) {
    return (
      <IdvScope
        className="mb-3 flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--idv-card)",
          border: "1px solid var(--idv-line)",
        }}
      >
        <Clock
          className="size-5 shrink-0"
          style={{ color: "var(--idv-warn)" }}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Vérification en cours</p>
          <p className="text-xs" style={{ color: "var(--idv-muted)" }}>
            Vous serez notifié du résultat.
          </p>
        </div>
      </IdvScope>
    );
  }

  const urgent = c.required;
  return (
    <IdvScope className="mb-3">
      <Link
        href={c.route}
        className="flex items-center gap-2.5 rounded-[14px] p-3 transition-transform active:scale-[.99]"
        style={{
          background: urgent ? "rgba(239,68,68,.10)" : "var(--idv-soft)",
          border: `1px solid ${urgent ? "rgba(239,68,68,.35)" : "var(--idv-line)"}`,
        }}
      >
        <ShieldAlert
          className="size-5 shrink-0"
          style={{ color: urgent ? "var(--idv-bad)" : "var(--idv-accent)" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {c.status === "rejected"
              ? "Vérification refusée"
              : urgent
                ? "Vérifiez votre identité"
                : "Vérifiez votre identité (facultatif)"}
          </p>
          <p className="text-xs" style={{ color: "var(--idv-muted)" }}>
            {c.status === "rejected"
              ? "Contactez le support"
              : urgent
                ? "Obligatoire pour continuer · 2 minutes"
                : "Document + selfie · 2 minutes"}
          </p>
        </div>
        <ChevronRight
          className="size-4 shrink-0"
          style={{ color: "var(--idv-muted)" }}
        />
      </Link>
    </IdvScope>
  );
}
