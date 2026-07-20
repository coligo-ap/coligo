// =============================================================================
// Bannières éditoriales — prompt 20 redesign.
// =============================================================================
// Lecture publique (RLS le permet) ; pas d'écriture côté client. La fenêtre
// active est déjà filtrée par la policy SQL (starts_at/ends_at).
// =============================================================================

import { createClient } from "@/lib/supabase/server";

/**
 * Détails LIVE d'une offre commerçant reliée à une bannière (mig 0330). Présent
 * UNIQUEMENT quand la bannière est visible (promo vivante + client à portée) →
 * jamais exposé hors zone / hors validité. Sert à alimenter la pop-up.
 */
/** Produit concerné par une promo (affiché sur la card si show_products). */
export type BannerProduct = {
  id: string;
  name_fr: string;
  name_ar: string | null;
  image_url: string | null;
  price_da: number;
};

export type BannerOffer = {
  promotion_id: string;
  type:
    | "product_discount"
    | "promo_code"
    | "quantity_offer"
    | "free_gift"
    | "free_delivery"
    | "flash_sale"
    | "anti_gaspillage";
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  gift_label: string | null;
  min_subtotal_da: number | null;
  title_fr: string;
  title_ar: string | null;
  ends_at: string | null;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  /** Produits concernés (mig 0391) — présents seulement si show_products. */
  products: BannerProduct[] | null;
};

export type PromoBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  image_url: string | null;
  image_fit: "cover" | "contain" | "overlay";
  /** Opacité de l'image en mode « Texture de fond » (0–100). */
  overlay_opacity: number;
  link: string | null;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  /** Modèle de card choisi (mig 0391) — NULL / "auto" = déduit du type. */
  template: string | null;
  /** Dégradé forcé (mig 0391) — NULL = celui du modèle. */
  palette: string | null;
  /** Illustration 3D forcée (mig 0392) — NULL / "auto" = celle du modèle. */
  illustration: string | null;
  /** Afficher les produits concernés sur la card (mig 0391). */
  show_products: boolean;
  position: number;
  /** Mode « offre commerçant » : bannière reliée à une promo. NULL = éditoriale. */
  merchant_slug: string | null;
  offer: BannerOffer | null;
};

/** Localisation de l'utilisateur pour le ciblage des bannières par zone. */
export type BannerViewerLocation = {
  lat: number | null;
  lng: number | null;
  wilaya: string | null;
  commune: string | null;
};

export async function getActiveBanners(
  loc?: BannerViewerLocation
): Promise<PromoBanner[]> {
  const supabase = await createClient();
  // RPC `active_banners_for` (mig 0249) : filtre déjà actif + fenêtre de dates
  // ET ciblage par ZONE (une bannière sans zone = globale ; sinon visible
  // seulement si l'utilisateur est dans l'une de ses zones). Hors types générés
  // → appel casté.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  const { data } = await rpc("active_banners_for", {
    p_lat: loc?.lat ?? null,
    p_lng: loc?.lng ?? null,
    p_wilaya: loc?.wilaya ?? null,
    p_commune: loc?.commune ?? null,
  });
  type Row = Omit<PromoBanner, "image_fit" | "offer" | "overlay_opacity"> & {
    image_fit?: string;
    overlay_opacity?: number | null;
    offer?: BannerOffer | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows.map((b) => {
    const offer = b.offer ?? null;
    return {
      ...b,
      image_fit: (b.image_fit ?? "overlay") as PromoBanner["image_fit"],
      overlay_opacity:
        b.overlay_opacity != null ? Number(b.overlay_opacity) : 30,
      template: b.template ?? null,
      palette: b.palette ?? null,
      illustration: b.illustration ?? null,
      show_products: b.show_products === true,
      // discount_value / min_subtotal / prix produits arrivent en NUMERIC.
      offer: offer
        ? {
            ...offer,
            discount_value:
              offer.discount_value != null
                ? Number(offer.discount_value)
                : null,
            min_subtotal_da:
              offer.min_subtotal_da != null
                ? Number(offer.min_subtotal_da)
                : null,
            products: Array.isArray(offer.products)
              ? offer.products.map((p) => ({
                  ...p,
                  price_da: Number(p.price_da),
                }))
              : null,
          }
        : null,
    };
  });
}
