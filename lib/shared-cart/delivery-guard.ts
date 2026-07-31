import { createAdminClient } from "@/lib/supabase/admin";
import { haversineKm } from "@/lib/delivery/distance";
import { computeDeliveryFee } from "@/lib/delivery/pricing";
import { evaluateZone } from "@/lib/zones/server";
import { zoneMessageFr } from "@/lib/zones/service-zones";
import { getFeatureFlags } from "@/lib/data/feature-flags";

// =============================================================================
// GARDE-FOU « une adresse est-elle livrable par CE commerçant ? »
//
// Même verdict que le checkout et que `createRoomOrder`, mais appliqué DÈS LA
// CONFIGURATION du panier partagé — pas seulement au moment de payer.
//
// Le problème réglé : le propriétaire pouvait choisir « Livraison express »
// vers une adresse HORS du rayon du commerçant, inviter toute la famille,
// remplir le panier… et n'apprendre qu'au paiement que c'était impossible.
// Désormais le refus tombe tout de suite, avec la distance et le rayon.
//
// Ordre des règles, identique au checkout :
//   1. le service express est-il actif (kill-switch super-admin) ;
//   2. le commerçant livre-t-il vraiment (delivery_enabled + express_enabled
//      + coordonnées connues) ;
//   3. la distance tient-elle dans le rayon (rayon commerçant, plafonné par le
//      rayon max plateforme) → BARÈME plateforme, jamais un prix client ;
//   4. le moteur de zones autorise-t-il la destination — FAIL-CLOSED : toute
//      indisponibilité refuse (on n'ouvre jamais la livraison « au doute »).
// =============================================================================

export type DeliveryPointVerdict =
  | {
      ok: true;
      /** Frais express au barème plateforme (DA) — informatif à ce stade. */
      feeDa: number;
      distanceKm: number;
    }
  | {
      ok: false;
      reason:
        | "express_off"
        | "no_delivery"
        | "no_pricing"
        | "out_of_range"
        | "zone";
      /** Message prêt à afficher au client (français, ton produit). */
      error: string;
      distanceKm?: number;
      maxRadiusKm?: number;
    };

/**
 * Contexte de décision, chargé UNE fois : réglages plateforme + géo commerçant.
 * Permet de juger une LISTE d'adresses sans relire la base à chaque ligne.
 */
export type DeliveryContext =
  | { ok: true; merchant: MerchantGeo; pricing: PlatformPricing }
  | { ok: false; verdict: Extract<DeliveryPointVerdict, { ok: false }> };

type MerchantGeo = {
  latitude: number;
  longitude: number;
  delivery_radius_km: number | null;
};
type PlatformPricing = {
  delivery_base_da: number;
  delivery_per_km_da: number;
  delivery_free_km_threshold: number;
  delivery_min_da: number;
  delivery_max_da: number;
  delivery_max_radius_km: number;
};

/** Charge le contexte (lecture SEULE en service_role : le client ne l'influence pas). */
export async function loadDeliveryContext(
  merchantId: string
): Promise<DeliveryContext> {
  const flags = await getFeatureFlags();
  if (flags.express.status !== "active") {
    return {
      ok: false,
      verdict: {
        ok: false,
        reason: "express_off",
        error:
          "La livraison express est momentanément indisponible — choisissez le retrait.",
      },
    };
  }

  const admin = createAdminClient();
  const [{ data: merch }, { data: pricing }] = await Promise.all([
    admin
      .from("merchants")
      .select(
        "latitude, longitude, delivery_radius_km, delivery_enabled, express_enabled"
      )
      .eq("id", merchantId)
      .maybeSingle(),
    admin
      .from("platform_settings")
      .select(
        "delivery_base_da, delivery_per_km_da, delivery_free_km_threshold, delivery_min_da, delivery_max_da, delivery_max_radius_km"
      )
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (
    merch?.latitude == null ||
    merch?.longitude == null ||
    merch.delivery_enabled === false ||
    merch.express_enabled === false
  ) {
    return {
      ok: false,
      verdict: {
        ok: false,
        reason: "no_delivery",
        error: "Ce commerçant ne livre pas — choisissez le retrait sur place.",
      },
    };
  }
  if (!pricing) {
    return {
      ok: false,
      verdict: {
        ok: false,
        reason: "no_pricing",
        error: "Barème de livraison indisponible — réessayez dans un instant.",
      },
    };
  }
  return {
    ok: true,
    merchant: merch as MerchantGeo,
    pricing: pricing as PlatformPricing,
  };
}

/** Juge UN point avec un contexte déjà chargé (aucune relecture commerçant). */
export async function judgeDeliveryPoint(
  ctx: DeliveryContext,
  lat: number,
  lng: number
): Promise<DeliveryPointVerdict> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return { ok: false, reason: "no_delivery", error: "Position invalide." };
  }
  if (!ctx.ok) return ctx.verdict;
  const { merchant: merch, pricing } = ctx;

  const distanceKm = haversineKm(
    { lat: merch.latitude, lng: merch.longitude },
    { lat, lng }
  );
  const quote = computeDeliveryFee(
    distanceKm,
    pricing,
    merch.delivery_radius_km
  );
  if (quote.outOfRange) {
    return {
      ok: false,
      reason: "out_of_range",
      // On dit la VÉRITÉ chiffrée : distance réelle et rayon du commerçant.
      // Le client comprend pourquoi et sait quoi faire (retrait, ou adresse
      // plus proche) — pas de « réessayez » vague.
      error: `Cette adresse est à ${distanceKm.toFixed(1)} km, au-delà du rayon de livraison de ce commerçant (${quote.maxRadiusKm} km). Choisissez le retrait sur place ou une adresse plus proche.`,
      distanceKm,
      maxRadiusKm: quote.maxRadiusKm,
    };
  }

  // Moteur de zones (mig 0169) — FAIL-CLOSED, comme à la commande.
  let wilayaCode: string | null = null;
  let commune: string | null = null;
  try {
    const { resolveWilayaCommune } = await import("@/lib/zones/server");
    const rc = await resolveWilayaCommune(lat, lng);
    wilayaCode = rc?.wilayaCode ?? null;
    commune = rc?.commune ?? null;
  } catch {
    /* best-effort : le contrôle géométrique reste appliqué */
  }
  let zone;
  try {
    zone = await evaluateZone("express", lat, lng, {
      role: "destination",
      wilayaCode,
      commune,
    });
  } catch {
    return {
      ok: false,
      reason: "zone",
      error: "Vérification de zone indisponible — réessayez dans un instant.",
    };
  }
  if (!zone || !zone.allowed) {
    return {
      ok: false,
      reason: "zone",
      error: zone
        ? zoneMessageFr(zone, "destination", "express")
        : "Vérification de zone indisponible — réessayez dans un instant.",
    };
  }

  return { ok: true, feeDa: quote.feeDa, distanceKm };
}

/**
 * Vérifie qu'un point de livraison est servable par le commerçant (cas unitaire
 * — charge le contexte puis juge). Pour une liste d'adresses, préférer
 * `loadDeliveryContext` + `judgeDeliveryPoint` : une seule lecture pour toutes.
 */
export async function checkMerchantDeliveryPoint(
  merchantId: string,
  lat: number,
  lng: number
): Promise<DeliveryPointVerdict> {
  return judgeDeliveryPoint(await loadDeliveryContext(merchantId), lat, lng);
}
