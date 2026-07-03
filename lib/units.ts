import type { ProductUnit } from "@/lib/types";

// =============================================================================
// Quantités par unité de vente — source de vérité PARTAGÉE client/serveur.
// =============================================================================
// Produits au poids/volume/longueur (kg, L, m) : le client choisit une
// quantité fractionnaire (pas de 250 g / 25 cl / 50 cm) et paie
// prix_unitaire × quantité. Produits à la pièce : quantités entières.
//
// Utilisé par : fiche produit (stepper), panier, checkout (validation
// serveur), affichages commande (board, détails, tickets — le ticket a déjà
// son formatQtyUnit compact 32 colonnes, on ne le touche pas).
// =============================================================================

export type UnitQtyConfig = {
  /** true = quantité fractionnaire autorisée (vente au poids/volume/longueur). */
  fractional: boolean;
  /** Pas du sélecteur (et quantité minimale), dans l'unité de vente. */
  step: number;
  /** Quantité max par ligne (garde-fou anti-fautes de frappe/abus). */
  max: number;
};

export const UNIT_QTY: Record<ProductUnit, UnitQtyConfig> = {
  piece: { fractional: false, step: 1, max: 999 },
  custom: { fractional: false, step: 1, max: 999 },
  kg: { fractional: true, step: 0.25, max: 200 },
  l: { fractional: true, step: 0.25, max: 200 },
  m: { fractional: true, step: 0.5, max: 500 },
};

function config(unit?: string | null): UnitQtyConfig {
  return UNIT_QTY[(unit ?? "piece") as ProductUnit] ?? UNIT_QTY.piece;
}

export function isFractionalUnit(unit?: string | null): boolean {
  return config(unit).fractional;
}

export function qtyStep(unit?: string | null): number {
  return config(unit).step;
}

/** Arrondi à 2 décimales — évite les dérives flottantes (0.25+0.5=0.75000…1). */
export function roundQty(q: number): number {
  return Math.round(q * 100) / 100;
}

/**
 * Normalise une quantité côté CLIENT (ajout panier, steppers) :
 * entier ≥ 1 pour la pièce, multiple du pas ≥ pas pour le fractionnaire.
 */
export function sanitizeQty(q: number, unit?: string | null): number {
  const c = config(unit);
  if (!Number.isFinite(q)) return c.step;
  if (!c.fractional) {
    return Math.min(c.max, Math.max(1, Math.floor(q)));
  }
  const snapped = roundQty(Math.round(q / c.step) * c.step);
  return Math.min(c.max, Math.max(c.step, snapped));
}

/**
 * Validation STRICTE côté SERVEUR (checkout) : on refuse plutôt que de
 * corriger en silence (le montant affiché au client doit rester le montant
 * facturé). Pièce → entier ; fractionnaire → 2 décimales max.
 */
export function isValidQty(q: number, unit?: string | null): boolean {
  const c = config(unit);
  if (!Number.isFinite(q) || q <= 0 || q > c.max) return false;
  if (!c.fractional) return Number.isInteger(q);
  return Math.abs(q - roundQty(q)) < 1e-9;
}

/**
 * Quantité MINIMALE effective d'une ligne : le min posé par le commerçant
 * (snappé au pas SUPÉRIEUR pour rester atteignable au stepper), sinon le pas
 * de l'unité (0.25 kg/L, 0.5 m) ou 1 à la pièce.
 */
export function minQtyFor(
  unit?: string | null,
  minQty?: number | null
): number {
  const c = config(unit);
  const base = c.fractional ? c.step : 1;
  if (minQty == null || !Number.isFinite(minQty) || minQty <= 0) return base;
  return Math.max(base, roundQty(Math.ceil(minQty / c.step - 1e-9) * c.step));
}

/**
 * Quantité MAXIMALE effective d'une ligne : min(garde-fou unité, max posé par
 * le commerçant, stock restant). Jamais sous le minimum effectif.
 */
export function maxQtyFor(
  unit?: string | null,
  maxQty?: number | null,
  stock?: number | null
): number {
  const c = config(unit);
  let m = c.max;
  if (maxQty != null && Number.isFinite(maxQty) && maxQty > 0) {
    m = Math.min(m, roundQty(Math.floor(maxQty / c.step + 1e-9) * c.step));
  }
  if (stock != null && Number.isFinite(stock)) m = Math.min(m, stock);
  return Math.max(m, minQtyFor(unit, null));
}

/** Libellés courts d'unités, FR et AR (parcours client bilingue). */
const UNIT_LABELS: Record<string, { fr: string; ar: string }> = {
  kg: { fr: "kg", ar: "كغ" },
  g: { fr: "g", ar: "غ" },
  l: { fr: "L", ar: "ل" },
  cl: { fr: "cl", ar: "سل" },
  m: { fr: "m", ar: "م" },
  cm: { fr: "cm", ar: "سم" },
};

function unitLabel(key: string, locale?: string): string {
  const l = UNIT_LABELS[key];
  if (!l) return key;
  return locale === "ar" ? l.ar : l.fr;
}

/** "1,5" (fr) / "1.5" brut sinon — séparateur décimal localisé. */
function formatNumber(q: number, locale?: string): string {
  const s = String(roundQty(q));
  return locale === "ar" ? s : s.replace(".", ",");
}

/**
 * Quantité lisible pour l'UI client/commerçant :
 * - pièce : "2" (le contexte ajoute « × » ou « x » si besoin) ;
 * - kg : "750 g" sous le kilo, "1,5 kg" au-delà ;
 * - L : "25 cl" sous le litre, "1,5 L" au-delà ;
 * - m : "50 cm" sous le mètre, "2 m" au-delà.
 */
export function formatQty(
  q: number,
  unit?: string | null,
  locale?: string
): string {
  const c = config(unit);
  if (!c.fractional) return String(Math.round(q));
  const rounded = roundQty(q);
  const SUB: Record<string, { sub: string; factor: number }> = {
    kg: { sub: "g", factor: 1000 },
    l: { sub: "cl", factor: 100 },
    m: { sub: "cm", factor: 100 },
  };
  const u = (unit ?? "") as string;
  const sub = SUB[u];
  if (sub && rounded < 1) {
    return `${Math.round(rounded * sub.factor)} ${unitLabel(sub.sub, locale)}`;
  }
  return `${formatNumber(rounded, locale)} ${unitLabel(u, locale)}`;
}
