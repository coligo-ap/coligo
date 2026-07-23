"use client";

import { useEffect, useState } from "react";
import { PromoBannerCarousel } from "@/components/customer/promo-banner-carousel";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { getBannersForLocation } from "@/app/(customer)/actions";
import { haversineKm } from "@/lib/delivery/distance";
import type {
  PromoBanner,
  BannerViewerLocation,
} from "@/lib/data/promo-banners";

// =============================================================================
// PromoBannerClient — rend le carrousel ET re-cible les bannières sur la
// position LIVE du navigateur (location-store) dès qu'elle DIFFÈRE de celle
// qu'a utilisée le SSR. C'est la MÊME source de position que la liste des
// commerces (événement `coligo:location:change`) : un client à Béjaïa voit les
// offres de Béjaïa, jamais celles d'Alger restées dans son adresse enregistrée.
//
// Si la position live == position SSR (ou inconnue côté navigateur), on garde le
// résultat SSR tel quel — AUCUN refetch inutile (règle perf « cache d'abord ») —
// et on suit les rafraîchissements SSR (nouvelle adresse enregistrée).
// =============================================================================

type Live = {
  lat: number | null;
  lng: number | null;
  wilaya: string | null;
  commune: string | null;
};

// La position live justifie-t-elle un re-ciblage vs ce que le serveur a utilisé ?
function locationDiffers(live: Live, ssr: BannerViewerLocation): boolean {
  const liveGeo = live.lat != null && live.lng != null;
  const ssrGeo = ssr.lat != null && ssr.lng != null;
  if (liveGeo && ssrGeo) {
    // Au-delà de ~500 m on peut basculer de zone / franchir le rayon d'un
    // commerçant → re-cibler. En deçà, le résultat serait identique.
    return (
      haversineKm(
        { lat: live.lat!, lng: live.lng! },
        { lat: ssr.lat!, lng: ssr.lng! }
      ) > 0.5
    );
  }
  if (liveGeo !== ssrGeo) return true; // l'un localisé au GPS, pas l'autre
  return (
    (live.wilaya ?? null) !== (ssr.wilaya ?? null) ||
    (live.commune ?? null) !== (ssr.commune ?? null)
  );
}

export function PromoBannerClient({
  initial,
  ssrLocation,
}: {
  initial: PromoBanner[];
  ssrLocation: BannerViewerLocation;
}) {
  const [banners, setBanners] = useState<PromoBanner[]>(initial);
  const loc = useCustomerLocation();

  const live: Live = {
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
    wilaya: loc?.wilaya_code ?? null,
    commune: loc?.commune ?? null,
  };
  const liveKnown = live.lat != null || !!live.wilaya;
  const refilter = liveKnown && locationDiffers(live, ssrLocation);

  useEffect(() => {
    // Position live alignée sur le SSR (ou inconnue) : le résultat serveur fait
    // foi — y compris quand le SSR se rafraîchit avec une nouvelle adresse.
    if (!refilter) {
      setBanners(initial);
      return;
    }
    let cancelled = false;
    void getBannersForLocation({
      lat: live.lat,
      lng: live.lng,
      wilaya: live.wilaya,
      commune: live.commune,
    }).then((b) => {
      if (!cancelled) setBanners(b);
    });
    return () => {
      cancelled = true;
    };
  }, [refilter, live.lat, live.lng, live.wilaya, live.commune, initial]);

  if (!banners.length) return null;
  return <PromoBannerCarousel banners={banners} />;
}
