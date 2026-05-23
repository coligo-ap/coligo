"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
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
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 1er render : pas encore lu localStorage → on n'a pas de wilaya, on
    // garde le fallback "tous commerces actifs".
    if (loc === null) return;

    startTransition(async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc.wilaya_code,
        commune: loc.commune,
      });
      setItems(res);
      setLoaded(true);
    });
  }, [loc]);

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-base font-bold lg:text-xl">
          {wilayaLabel
            ? `Commerces à ${wilayaLabel}${loc?.commune ? ` · ${loc.commune}` : ""}`
            : "Commerces en Algérie"}
        </h2>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {items.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
          <MapPin className="text-subtle mx-auto mb-2 size-6" />
          {loc?.wilaya_code
            ? "Aucun commerce dans cette zone pour le moment."
            : "Aucun commerce actif disponible."}
          <p className="mt-3">
            <Link
              href="/search"
              className="text-primary-700 font-medium hover:underline"
            >
              Élargir la recherche →
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}

      {!loaded && loc?.wilaya_code && pending && items === fallback && (
        <p className="text-subtle text-xs">Filtrage par {wilayaLabel}…</p>
      )}
    </div>
  );
}
