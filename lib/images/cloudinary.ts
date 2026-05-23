// =============================================================================
// Cloudinary Fetch — couche d'optimisation au-dessus des URLs existantes.
// =============================================================================
// On NE migre PAS les uploads (Supabase Storage reste la source). À l'affichage
// on enveloppe l'URL d'origine dans une URL Cloudinary Fetch optimisée :
//
//   https://res.cloudinary.com/{cloud}/image/fetch/f_auto,q_auto,w_800/{src}
//
// Avantages :
//   - f_auto = WebP/AVIF selon le navigateur (énorme gain de poids).
//   - q_auto = qualité visuellement neutre, fichier ~30–50 % plus léger.
//   - w_X = redimensionnement à la volée (responsive).
//   - Aucun changement DB, aucune migration d'image.
//
// Fallback : si `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` n'est pas défini, on
// retourne l'URL d'origine inchangée (zéro casse).
//
// Pré-requis Cloudinary : dashboard → Settings → Security → "Fetched URL: allow"
// pour les domaines (Supabase, Unsplash).

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

export type CldOptions = {
  /** Largeur cible en pixels. */
  width?: number;
  /** Hauteur cible. Utilisée surtout avec crop. */
  height?: number;
  /** Mode de crop. `fill` = remplit (recadre), `fit` = inscrit (lettrebox). */
  crop?: "fill" | "fit" | "limit" | "scale" | "thumb";
  /** Gravité pour les crops `fill` (visages, auto, centre). */
  gravity?: "auto" | "face" | "center";
  /** DPR (1, 2, 3). `auto` laisse Cloudinary choisir selon le user-agent. */
  dpr?: number | "auto";
};

/**
 * Construit une URL Cloudinary Fetch optimisée à partir d'une URL source.
 * - `src` null/vide → renvoie `null`.
 * - Pas de cloud_name configuré → renvoie l'URL d'origine.
 * - Déjà une URL Cloudinary (`res.cloudinary.com`) → renvoie telle quelle.
 */
export function cldUrl(
  src: string | null | undefined,
  opts: CldOptions = {}
): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (!CLOUD_NAME) return trimmed;
  if (trimmed.includes("res.cloudinary.com/")) return trimmed;
  // Doit être une URL absolue pour Fetch (data: et / ne sont pas supportés).
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const parts: string[] = ["f_auto", "q_auto"];
  if (opts.width) parts.push(`w_${Math.round(opts.width)}`);
  if (opts.height) parts.push(`h_${Math.round(opts.height)}`);
  if (opts.crop) parts.push(`c_${opts.crop}`);
  if (opts.gravity) parts.push(`g_${opts.gravity}`);
  if (opts.dpr) parts.push(`dpr_${opts.dpr}`);

  const transforms = parts.join(",");
  // Cloudinary Fetch attend l'URL source telle quelle (pas double-encodée).
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/fetch/${transforms}/${trimmed}`;
}

/**
 * Génère une chaîne `srcset` pour image responsive.
 * Renvoie `undefined` si pas de cloud (laisser le navigateur charger une seule
 * version).
 */
export function cldSrcSet(
  src: string | null | undefined,
  widths: number[],
  baseOpts: CldOptions = {}
): string | undefined {
  if (!src || !CLOUD_NAME) return undefined;
  return widths
    .map((w) => {
      const url = cldUrl(src, { ...baseOpts, width: w });
      return url ? `${url} ${w}w` : null;
    })
    .filter(Boolean)
    .join(", ");
}

/** True si Cloudinary est configuré pour la session courante. */
export function isCloudinaryEnabled(): boolean {
  return !!CLOUD_NAME;
}
