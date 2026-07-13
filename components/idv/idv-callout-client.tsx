"use client";

import { useEffect, useState } from "react";
import { fetchIdvCompliance } from "@/app/idv/actions";
import type { IdvCompliance } from "@/lib/idv/compliance";
import { IdvVerifyCard } from "./idv-verify-card";
import { idvStateOf } from "./idv-verify-step";

// =============================================================================
// IDV — appel à vérification, variante CLIENT (compte chauffeur, rendu côté
// client par choix de perf). Elle charge son état après le montage et NE
// RÉSERVE AUCUNE PLACE tant qu'elle n'a rien à dire : pas de saut de mise en
// page pour une ligne qui, le plus souvent, n'existera pas. L'affichage est
// celui du SYSTÈME PARTAGÉ (IdvVerifyCard) — identique aux autres espaces.
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
  return (
    <div className="mb-3">
      <IdvVerifyCard idv={idvStateOf(c)} />
    </div>
  );
}
