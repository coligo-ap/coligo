// =============================================================================
// Modèles de bannière promo — SOURCE PARTAGÉE (rendu client + gestion admin).
// =============================================================================
// Un « modèle » = un dégradé (palette) + une illustration 3D auto-hébergée + une
// décoration (scooter animé / compte à rebours). Le super-admin choisit un
// modèle et, s'il veut, force une palette différente. « auto » = le modèle est
// déduit du TYPE de promo (comportement du Lot 1).
// =============================================================================

import { PROMO_GRADIENTS } from "@/lib/design/tokens";
import type { PromoBanner } from "@/lib/data/promo-banners";

/**
 * Dégradés doux repris de la maquette « coligo-collection-finale » —
 * valeurs centralisées dans `lib/design/tokens.ts` (PROMO_GRADIENTS).
 */
export const PROMO_GRAD = PROMO_GRADIENTS;

export type PromoPalette = keyof typeof PROMO_GRAD;

export const PALETTE_LABELS: Record<PromoPalette, string> = {
  deliv: "Livraison (violet clair)",
  brand: "Marque (violet → rose)",
  mint: "Menthe",
  sky: "Ciel",
  dusk: "Nuit dorée",
  slate: "Ardoise (sombre)",
};

export type PromoArt =
  | "scooter"
  | "percent"
  | "megaphone"
  | "confetti"
  | "emoji-stars"
  | "cashback"
  | "none";

export const ART_LABELS: Record<PromoArt, string> = {
  scooter: "Scooter Coligo",
  percent: "Réduction 3D « % »",
  megaphone: "Mégaphone",
  confetti: "Confettis",
  "emoji-stars": "Étoiles",
  cashback: "Cashback 3D",
  none: "Aucune illustration",
};

/**
 * Illustrations 3D proposables au super-admin. Pour ENRICHIR le pack : déposer
 * un PNG dans `public/promo/<clé>.png`, l'ajouter à `PromoArt` + `ART_LABELS`
 * + ici. Tout est auto-hébergé (aucun CDN externe).
 */
export const ILLUSTRATIONS: PromoArt[] = [
  "scooter",
  "percent",
  "megaphone",
  "confetti",
  "emoji-stars",
  "cashback",
  "none",
];

export type PromoModel = {
  /** Clé stockée (`promo_banners.template`). */
  key: string;
  label: string;
  palette: PromoPalette;
  art: PromoArt;
  /** Animation « roule » (scooter) plutôt que le flottement standard. */
  ride?: boolean;
  /** Compte à rebours (nécessite une date de fin sur l'offre). */
  countdown?: boolean;
};

/** Modèle spécial « laisser Coligo choisir selon le type de promo ». */
export const AUTO_MODEL: PromoModel = {
  key: "auto",
  label: "Automatique (selon le type de promo)",
  palette: "brand",
  art: "none",
};

/** Modèles CHOISISSABLES par le super-admin (hors « auto »). */
export const PROMO_MODELS: PromoModel[] = [
  {
    key: "scooter",
    label: "Livraison — scooter Coligo",
    palette: "deliv",
    art: "scooter",
    ride: true,
  },
  {
    key: "percent",
    label: "Réduction — 3D « % »",
    palette: "brand",
    art: "percent",
  },
  {
    key: "megaphone",
    label: "Annonce / code — mégaphone",
    palette: "brand",
    art: "megaphone",
  },
  {
    key: "gift",
    label: "Cadeau — confettis",
    palette: "brand",
    art: "confetti",
  },
  {
    key: "stars",
    label: "Coup de cœur — étoiles",
    palette: "sky",
    art: "emoji-stars",
  },
  {
    key: "cashback",
    label: "Cashback — pièces 3D",
    palette: "dusk",
    art: "cashback",
  },
  {
    key: "flash",
    label: "Vente flash — compte à rebours",
    palette: "dusk",
    art: "confetti",
    countdown: true,
  },
  {
    key: "clean",
    label: "Épuré — sans illustration",
    palette: "brand",
    art: "none",
  },
];

const BY_KEY = new Map<string, PromoModel>(
  [AUTO_MODEL, ...PROMO_MODELS].map((m) => [m.key, m])
);

export function modelByKey(key: string | null | undefined): PromoModel | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/** Modèle AUTOMATIQUE selon le type de promo (offre) ou l'accent (éditoriale). */
export function autoModel(banner: PromoBanner): PromoModel {
  const m = (key: string) => modelByKey(key)!;
  switch (banner.offer?.type) {
    case "free_delivery":
      return m("scooter");
    case "product_discount":
      return m("percent");
    case "promo_code":
      return m("megaphone");
    case "free_gift":
      return m("gift");
    case "quantity_offer":
      return { ...m("stars"), palette: "sky" };
    case "anti_gaspillage":
      return { ...m("stars"), palette: "mint" };
    case "flash_sale":
      return m("flash");
  }
  // Bannière éditoriale : mappée sur l'accent existant.
  const byAccent: Record<PromoBanner["accent"], PromoModel> = {
    violet: m("megaphone"),
    coral: { ...m("gift"), palette: "brand" },
    mint: { ...m("stars"), palette: "mint" },
    amber: { ...m("cashback"), palette: "dusk" },
    dark: { ...m("cashback"), palette: "slate" },
  };
  return byAccent[banner.accent] ?? m("percent");
}

/** Modèle EFFECTIF d'une bannière (template choisi > auto) + palette forcée. */
export function resolveModel(banner: PromoBanner): {
  model: PromoModel;
  grad: string;
} {
  const chosen =
    banner.template && banner.template !== "auto"
      ? modelByKey(banner.template)
      : null;
  const base = chosen ?? autoModel(banner);
  const palette = (banner.palette as PromoPalette) || base.palette;
  // Illustration FORCÉE (mig 0392) : "auto" / null = celle du modèle.
  const artOverride =
    banner.illustration && banner.illustration !== "auto"
      ? (banner.illustration as PromoArt)
      : null;
  const model = artOverride ? { ...base, art: artOverride } : base;
  return { model, grad: PROMO_GRAD[palette] ?? PROMO_GRAD.brand };
}
