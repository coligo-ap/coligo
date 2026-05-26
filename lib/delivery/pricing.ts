/**
 * Tarif de livraison — fonction PURE (testable sans Supabase, sans I/O).
 *
 * Modèle imposé par la plateforme :
 *   fee = clamp(base + max(0, distance - free_km) * per_km, [min, max])
 *
 * Si la distance dépasse `delivery_max_radius_km`, la livraison est REFUSÉE
 * (résultat `outOfRange: true`, `feeDa: null`). Le commerçant peut RÉDUIRE
 * son rayon en deçà du max plateforme mais pas l'étendre au-delà.
 *
 * Le commerçant ne fixe AUCUN paramètre du barème ; il choisit uniquement
 * son rayon (≤ delivery_max_radius_km). C'est la garantie anti-abus pour
 * les clients (cf. PROMPTS-A-FAIRE/02-LIVRAISON-FONDATIONS.md — PARTIE A).
 */

import type { DeliveryPricing } from "@/lib/types";

export type DeliveryQuote =
  | {
      outOfRange: false;
      /** Frais final, arrondi à l'entier le plus proche (DA). */
      feeDa: number;
      /** Détail pédagogique pour le simulateur commerçant. */
      breakdown: {
        baseDa: number;
        billableKm: number;
        kmCostDa: number;
        beforeClamp: number;
        clamped: "min" | "max" | null;
      };
    }
  | {
      outOfRange: true;
      feeDa: null;
      reason: "beyond_max_radius";
      maxRadiusKm: number;
    };

/**
 * Calcule le prix de livraison pour une distance donnée (km, à vol d'oiseau ;
 * la distance réelle utilisée en checkout dépendra de l'étape 4 « Position
 * client » mais le contrat de cette fonction reste identique).
 *
 * - `distanceKm` négatif → traité comme 0 (entrée invalide tolérée).
 * - Pas d'I/O, pas d'effet de bord : on peut l'appeler côté serveur ou
 *   client (simulateur sur l'écran commerçant).
 */
export function computeDeliveryFee(
  distanceKm: number,
  s: DeliveryPricing,
  /** Optionnel : rayon spécifique au commerçant (≤ s.delivery_max_radius_km). */
  merchantRadiusKm?: number | null
): DeliveryQuote {
  const dist = Math.max(0, distanceKm);
  const effectiveRadius =
    merchantRadiusKm != null && merchantRadiusKm > 0
      ? Math.min(merchantRadiusKm, s.delivery_max_radius_km)
      : s.delivery_max_radius_km;

  if (dist > effectiveRadius) {
    return {
      outOfRange: true,
      feeDa: null,
      reason: "beyond_max_radius",
      maxRadiusKm: effectiveRadius,
    };
  }

  const billableKm = Math.max(0, dist - s.delivery_free_km_threshold);
  const kmCostDa = billableKm * s.delivery_per_km_da;
  const beforeClamp = s.delivery_base_da + kmCostDa;

  let feeDa = beforeClamp;
  let clamped: "min" | "max" | null = null;
  if (feeDa < s.delivery_min_da) {
    feeDa = s.delivery_min_da;
    clamped = "min";
  } else if (feeDa > s.delivery_max_da) {
    feeDa = s.delivery_max_da;
    clamped = "max";
  }

  return {
    outOfRange: false,
    feeDa: Math.round(feeDa),
    breakdown: {
      baseDa: s.delivery_base_da,
      billableKm: Number(billableKm.toFixed(2)),
      kmCostDa: Math.round(kmCostDa),
      beforeClamp: Math.round(beforeClamp),
      clamped,
    },
  };
}

/**
 * Borne un rayon commerçant au max plateforme (utile côté UI pour le slider).
 */
export function clampMerchantRadius(
  requestedKm: number | null,
  maxRadiusKm: number
): number {
  if (requestedKm == null || requestedKm <= 0) return 0;
  return Math.min(requestedKm, maxRadiusKm);
}

/*
 * --- Cas pédagogiques (à valider à la main ; voir le simulateur UI) ---
 * Avec defaults : base=180, per_km=40, free_km=2, min=180, max=450, max_radius=10.
 *
 *   distance | brut             | borné                      | quote
 *   ---------+------------------+----------------------------+------------------
 *   0 km     | 180 + 0   = 180  | clamp(180, 180, 450) = 180 | 180 DA
 *   2 km     | 180 + 0   = 180  | 180                        | 180 DA
 *   3 km     | 180 + 40  = 220  | 220                        | 220 DA
 *   5 km     | 180 + 120 = 300  | 300                        | 300 DA
 *   8 km     | 180 + 240 = 420  | 420                        | 420 DA
 *   9 km     | 180 + 280 = 460  | clamp → 450 (max)          | 450 DA (max)
 *   10 km    | 180 + 320 = 500  | clamp → 450 (max)          | 450 DA (max)
 *   11 km    | hors rayon                                    | outOfRange
 */
