"use client";

import { useEffect, useState } from "react";
import { PromoBannerCarousel } from "@/components/customer/promo-banner-carousel";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { getBannersForLocation } from "@/app/(customer)/actions";
import type { PromoBanner } from "@/lib/data/promo-banners";

// =============================================================================
// PromoBannerClient — rend le carrousel ET, pour les visiteurs sans position
// connue côté serveur (anonymes), RE-FILTRE les bannières par ZONE à partir de
// la position du NAVIGATEUR (localStorage). Sans ce repli, un anonyme ne verrait
// que les bannières globales (le SSR ignore sa position). Les utilisateurs dont
// le serveur connaît déjà la position (`geoFallback=false`) gardent le résultat
// SSR (leur adresse enregistrée fait foi).
// =============================================================================

export function PromoBannerClient({
  initial,
  geoFallback,
}: {
  initial: PromoBanner[];
  geoFallback: boolean;
}) {
  const [banners, setBanners] = useState<PromoBanner[]>(initial);
  const loc = useCustomerLocation();

  useEffect(() => {
    if (!geoFallback) return;
    // Rien à recibler tant qu'on n'a ni coordonnées ni wilaya côté navigateur.
    const hasGeo = loc?.latitude != null && loc?.longitude != null;
    if (!hasGeo && !loc?.wilaya_code) return;
    let cancelled = false;
    void getBannersForLocation({
      lat: loc?.latitude ?? null,
      lng: loc?.longitude ?? null,
      wilaya: loc?.wilaya_code ?? null,
      commune: loc?.commune ?? null,
    }).then((b) => {
      if (!cancelled) setBanners(b);
    });
    return () => {
      cancelled = true;
    };
  }, [
    geoFallback,
    loc?.latitude,
    loc?.longitude,
    loc?.wilaya_code,
    loc?.commune,
  ]);

  if (!banners.length) return null;
  return <PromoBannerCarousel banners={banners} />;
}
