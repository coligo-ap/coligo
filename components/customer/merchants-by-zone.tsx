"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, MapPin } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { fetchMerchantsForZone } from "@/app/(customer)/actions";
import { MerchantCard } from "@/components/customer/merchant-card";
import type { PublicMerchant } from "@/lib/data/merchants-public";

type Props = {
  /** Liste pré-chargée côté serveur (rendue immédiatement, sans filtre). */
  fallback: PublicMerchant[];
};

export function MerchantsByZone({ fallback }: Props) {
  const loc = useCustomerLocation();
  const [items, setItems] = useState<PublicMerchant[]>(fallback);
  // Quand la zone est vide, on bascule sur `fallback` (tous les commerces) et
  // on l'indique pour afficher un petit hint contextuel.
  const [emptyZone, setEmptyZone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // 1er render : pas encore lu localStorage → on garde le fallback global.
    if (loc === null) return;
    // Pas de wilaya choisie → fallback global (tous commerces).
    if (!loc.wilaya_code) {
      setItems(fallback);
      setEmptyZone(false);
      return;
    }

    startTransition(async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc.wilaya_code,
        commune: loc.commune,
      });
      if (res.length === 0) {
        // Aucun commerce dans la zone → on affiche TOUS les commerces actifs
        // (catégories restent en haut pour filtrer si l'utilisateur le souhaite).
        setItems(fallback);
        setEmptyZone(true);
      } else {
        setItems(res);
        setEmptyZone(false);
      }
    });
  }, [loc, fallback]);

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-base font-bold lg:text-xl">
          {emptyZone
            ? "Tous les commerces en Algérie"
            : wilayaLabel
              ? `Commerces à ${wilayaLabel}${loc?.commune ? ` · ${loc.commune}` : ""}`
              : "Commerces en Algérie"}
        </h2>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {emptyZone && wilayaLabel && (
        <div className="border-warning-100 bg-warning-50 text-warning-800 flex items-start gap-2 rounded-[14px] border px-3 py-2 text-xs">
          <MapPin className="text-warning-600 mt-0.5 size-3.5 shrink-0" />
          <span>
            Pas encore de commerces à <strong>{wilayaLabel}</strong> — en
            attendant, voici ceux disponibles ailleurs.
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
          <MapPin className="text-subtle mx-auto mb-2 size-6" />
          Aucun commerce actif disponible pour le moment.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}
    </div>
  );
}
