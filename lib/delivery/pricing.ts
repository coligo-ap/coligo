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

/** Une bande de prix tournée (zone de distance) configurée par le commerçant. */
export type TourBand = {
  band_index: number;
  /** Borne haute de la bande, en km (3, 6, 10…). */
  max_km: number;
  /** Prix fixé par le commerçant pour cette bande (DA). */
  price_da: number;
};

/**
 * Plafond (= prix par défaut) d'une bande tournée : le prix BARÈME plateforme à
 * la borne haute de la bande. Le commerçant ne peut JAMAIS dépasser ce plafond.
 */
export function tourBandCeilingDa(upperKm: number, s: DeliveryPricing): number {
  const q = computeDeliveryFee(upperKm, s);
  return q.outOfRange ? s.delivery_max_da : q.feeDa;
}

/**
 * Prix de livraison TOURNÉE pour une distance : la bande dont la borne haute
 * couvre la distance (plus petite max_km ≥ distance). Le prix est borné côté
 * affichage à [delivery_min_da, plafond barème] — le serveur clampe aussi (0119).
 *
 * Fallback barème si aucune bande n'est configurée (sécurité). Hors rayon ou
 * au-delà de la dernière bande → `outOfRange`.
 */
export function computeTourDeliveryFee(
  distanceKm: number,
  bands: TourBand[],
  s: DeliveryPricing,
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
  if (bands.length === 0) {
    // Pas de bande configurée → on retombe sur le barème (jamais bloquant).
    return computeDeliveryFee(distanceKm, s, merchantRadiusKm);
  }

  const sorted = [...bands].sort((a, b) => a.max_km - b.max_km);
  const band = sorted.find((b) => dist <= b.max_km);
  if (!band) {
    return {
      outOfRange: true,
      feeDa: null,
      reason: "beyond_max_radius",
      maxRadiusKm: effectiveRadius,
    };
  }

  const ceiling = tourBandCeilingDa(band.max_km, s);
  const feeDa = Math.min(
    Math.max(Math.round(band.price_da), s.delivery_min_da),
    ceiling
  );
  return {
    outOfRange: false,
    feeDa,
    breakdown: {
      baseDa: s.delivery_base_da,
      billableKm: Number(dist.toFixed(2)),
      kmCostDa: 0,
      beforeClamp: feeDa,
      clamped: null,
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
