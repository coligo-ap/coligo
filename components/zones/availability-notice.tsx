"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { ServiceKind } from "@/lib/zones/service-zones";
import { getProvidersOnline } from "@/lib/zones/actions";

/**
 * Notice SOFT « peu de prestataires en ligne » (non-bloquante). N'apparaît QUE
 * quand AUCUN livreur/chauffeur n'est en ligne près du point (signal réel et
 * rare) — jamais en cas d'erreur infra (count = -1). Volontairement
 * rassurante : la demande est tout de même prise/diffusée.
 *
 * Choix produit : NON-BLOQUANT. Les prestataires se connectent en continu
 * (Express dispatché au temps de prépa) → bloquer causerait de faux refus.
 */
export function AvailabilityNotice({
  service,
  lat,
  lng,
  radiusKm,
  className = "",
}: {
  service: ServiceKind;
  lat: number | null | undefined;
  lng: number | null | undefined;
  radiusKm?: number;
  className?: string;
}) {
  const [count, setCount] = useState<number>(-1);

  useEffect(() => {
    if (lat == null || lng == null) {
      setCount(-1);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await getProvidersOnline({ service, lat, lng, radiusKm });
      if (alive) setCount(r.count);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [service, lat, lng, radiusKm]);

  if (count !== 0) return null; // -1 (inconnu) ou >0 → rien

  const msg =
    service === "drive"
      ? "Peu de chauffeurs en ligne dans cette zone pour l'instant — l'attente peut être plus longue, votre demande sera diffusée dès qu'un chauffeur se connecte."
      : "Peu de livreurs en ligne dans votre secteur pour l'instant — votre commande sera proposée dès qu'un livreur est disponible.";

  return (
    <div
      className={
        "flex items-start gap-2 rounded-[12px] border border-sky-200 bg-sky-50 p-3 text-[12.5px] font-semibold text-sky-800 " +
        className
      }
    >
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}
