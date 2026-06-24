"use client";

import { getPosition } from "@/lib/native";
import {
  reverseGeocode,
  updateCustomerLocation,
} from "@/app/(customer)/actions";
// Libellé d'adresse PRÉCIS (rue/quartier) pour l'affichage.
import { reverseGeocode as reverseGeocodeAddress } from "@/lib/geo/geocode";
import { writeStoredLocation } from "@/lib/customer/location-store";

/**
 * Détecte la position GPS du client, la reverse-géocode (wilaya/commune +
 * adresse exacte) et la persiste (localStorage + DB si connecté).
 *
 * Déclenche la demande d'autorisation native si nécessaire (à appeler depuis un
 * geste utilisateur — bouton « Autoriser la localisation »). Ne lève jamais :
 * renvoie `true` si une position a été obtenue et stockée, `false` sinon.
 */
export async function detectAndStoreLocation(opts?: {
  highAccuracy?: boolean;
}): Promise<boolean> {
  let coords;
  try {
    coords = await getPosition(
      opts?.highAccuracy
        ? { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
        : { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 }
    );
  } catch {
    return false; // refus / indisponible
  }

  // Wilaya + commune (best-effort).
  let geo;
  try {
    geo = await reverseGeocode({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  } catch {
    geo = { ok: false } as const;
  }
  const wilayaCode = geo.ok ? (geo.wilaya_code ?? null) : null;
  const commune = geo.ok ? (geo.commune ?? null) : null;

  // Adresse exacte lisible (best-effort).
  let address: string | null = null;
  try {
    address = await reverseGeocodeAddress(coords.latitude, coords.longitude);
  } catch {
    /* géocodage indispo : on retombe sur commune · wilaya */
  }

  writeStoredLocation({
    latitude: coords.latitude,
    longitude: coords.longitude,
    wilaya_code: wilayaCode,
    commune,
    address,
  });

  // Sync DB si connecté (no-op silencieux sinon).
  try {
    await updateCustomerLocation({
      latitude: coords.latitude,
      longitude: coords.longitude,
      wilaya_code: wilayaCode,
      commune,
    });
  } catch {
    /* offline / RLS — on garde la version locale */
  }

  return true;
}
