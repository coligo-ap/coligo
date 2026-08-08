import type {
  BannerInput,
  BannerZone,
  OfferOption,
} from "@/app/admin/bannieres/actions";

export type AdminBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  image_url: string | null;
  image_fit: "cover" | "contain" | "overlay";
  overlay_opacity: number;
  link: string | null;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  /** Modèle de card (mig 0391) — NULL / "auto" = déduit du type. */
  template: string | null;
  /** Dégradé forcé (mig 0391) — NULL = celui du modèle. */
  palette: string | null;
  /** Illustration 3D forcée (mig 0392) — NULL / "auto" = celle du modèle. */
  illustration: string | null;
  /** Afficher les produits concernés sur la card (mig 0391). */
  show_products: boolean;
  position: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  zones: BannerZone[];
  /** Mode « offre commerçant » (mig 0330). NULL = bannière éditoriale. */
  promotion_id: string | null;
  merchant_id: string | null;
  geo_radius_km: number | null;
  /** Résolus côté serveur pour l'affichage/édition (non persistés ici). */
  merchant_name: string | null;
  merchant_slug: string | null;
  offer_summary: string | null;
  /** L'offre reliée est-elle toujours active ? (false ⇒ bannière masquée). */
  offer_active: boolean | null;
};

type ImageFit = AdminBanner["image_fit"];
export const FIT_OPTIONS: { value: ImageFit; label: string; hint: string }[] = [
  {
    value: "cover",
    label: "Pleine (remplit)",
    hint: "L'image couvre toute la bannière (recadrée si besoin) — « en full ».",
  },
  {
    value: "contain",
    label: "Entière (visible)",
    hint: "L'image entière reste visible, centrée sur le fond de couleur.",
  },
  {
    value: "overlay",
    label: "Texture de fond",
    hint: "Image en fond discret (atténuée) sous le texte.",
  },
];

export const ACCENTS = ["violet", "coral", "mint", "amber", "dark"] as const;

export const ACCENT_CLASSES: Record<AdminBanner["accent"], string> = {
  violet: "from-primary-700 via-primary-600 to-primary-500 text-white",
  coral: "from-coral-700 via-coral-600 to-coral-500 text-white",
  mint: "from-mint-700 via-mint-600 to-mint-500 text-white",
  amber: "from-amber-600 via-amber-500 to-amber-400 text-foreground",
  dark: "from-foreground via-foreground/95 to-foreground/85 text-white",
};

export const ACCENT_LABELS: Record<AdminBanner["accent"], string> = {
  violet: "Violet",
  coral: "Corail",
  mint: "Menthe",
  amber: "Ambre",
  dark: "Sombre",
};

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function emptyDraft(): Draft {
  return {
    mode: "editorial",
    title: "",
    subtitle: "",
    cta_label: "",
    image_url: "",
    image_fit: "cover",
    overlay_opacity: 30,
    link: "",
    accent: "violet",
    template: "auto",
    palette: "",
    illustration: "auto",
    show_products: false,
    position: 0,
    active: true,
    starts_at: "",
    ends_at: "",
    zones: [],
    merchant_id: "",
    merchant_label: "",
    promotion_id: "",
    offer_summary: "",
    geo_radius_km: "",
  };
}

// Brouillon = état du formulaire (dates en valeur datetime-local).
export type Draft = {
  /** Éditoriale (visuel + lien) ou offre reliée à une promotion commerçant. */
  mode: "editorial" | "offer";
  title: string;
  subtitle: string;
  cta_label: string;
  image_url: string;
  image_fit: ImageFit;
  overlay_opacity: number;
  link: string;
  accent: AdminBanner["accent"];
  /** Modèle de card ("auto" = selon le type). */
  template: string;
  /** Palette forcée ("" = celle du modèle). */
  palette: string;
  /** Illustration forcée ("auto" = celle du modèle). */
  illustration: string;
  /** Afficher les produits concernés (offres). */
  show_products: boolean;
  position: number;
  active: boolean;
  starts_at: string;
  ends_at: string;
  zones: BannerZone[];
  /** Mode offre : commerçant + promotion sélectionnés. */
  merchant_id: string;
  merchant_label: string;
  promotion_id: string;
  offer_summary: string;
  /** Rayon de ciblage forcé (km) — "" = auto (portée du commerçant). */
  geo_radius_km: string;
};

export function bannerToDraft(b: AdminBanner): Draft {
  const isOffer = !!b.merchant_id && !!b.promotion_id;
  return {
    mode: isOffer ? "offer" : "editorial",
    title: b.title,
    subtitle: b.subtitle ?? "",
    cta_label: b.cta_label ?? "",
    image_url: b.image_url ?? "",
    image_fit: b.image_fit ?? "overlay",
    overlay_opacity: b.overlay_opacity ?? 30,
    link: b.link ?? "",
    accent: b.accent,
    template: b.template ?? "auto",
    palette: b.palette ?? "",
    illustration: b.illustration ?? "auto",
    show_products: b.show_products ?? false,
    position: b.position,
    active: b.active,
    starts_at: isoToLocalInput(b.starts_at),
    ends_at: isoToLocalInput(b.ends_at),
    zones: b.zones ?? [],
    merchant_id: b.merchant_id ?? "",
    merchant_label: b.merchant_name ?? "",
    promotion_id: b.promotion_id ?? "",
    offer_summary: b.offer_summary ?? "",
    geo_radius_km: b.geo_radius_km != null ? String(b.geo_radius_km) : "",
  };
}

export function draftToInput(d: Draft): BannerInput {
  const isOffer = d.mode === "offer";
  const radius = Number(d.geo_radius_km);
  return {
    title: d.title,
    subtitle: d.subtitle,
    cta_label: d.cta_label,
    image_url: d.image_url,
    image_fit: d.image_fit,
    overlay_opacity: d.overlay_opacity,
    link: isOffer ? "" : d.link,
    accent: d.accent,
    template: d.template && d.template !== "auto" ? d.template : null,
    palette: d.palette || null,
    illustration:
      d.illustration && d.illustration !== "auto" ? d.illustration : null,
    // L'affichage des produits n'a de sens que pour une offre commerçant.
    show_products: isOffer ? d.show_products : false,
    position: Number(d.position) || 0,
    active: d.active,
    starts_at: localInputToIso(d.starts_at),
    ends_at: localInputToIso(d.ends_at),
    zones: isOffer ? [] : d.zones,
    promotion_id: isOffer && d.promotion_id ? d.promotion_id : null,
    merchant_id: isOffer && d.merchant_id ? d.merchant_id : null,
    geo_radius_km:
      isOffer && d.geo_radius_km.trim() && radius > 0 ? radius : null,
  };
}

/** Libellé court d'une offre pour les cartes du sélecteur. */
export function offerSummary(o: OfferOption): string {
  const val =
    o.discount_value != null ? Math.round(Number(o.discount_value)) : 0;
  const money = (n: number) =>
    o.discount_kind === "percent" ? `−${n}%` : `−${n} DA`;
  if (o.type === "free_delivery") return "Livraison offerte";
  if (o.type === "free_gift") return o.gift_label || "Cadeau offert";
  if (o.type === "flash_sale") return `Vente flash ${money(val)}`;
  if (o.type === "anti_gaspillage") return `Anti-gaspi ${money(val)}`;
  if (o.type === "quantity_offer" && o.buy_qty && o.get_qty) {
    return `${o.buy_qty} achetés = ${o.get_qty} offert${o.get_qty > 1 ? "s" : ""}`;
  }
  if (o.type === "promo_code") {
    return `Code${o.code ? ` ${o.code.toUpperCase()}` : ""}${val ? ` · ${money(val)}` : ""}`;
  }
  return val ? `Réduction ${money(val)}` : "Réduction produit";
}

/** CTA suggéré selon le type d'offre. */
export function suggestedCta(o: OfferOption): string {
  if (o.type === "promo_code") return "Récupérer mon code";
  if (o.type === "free_delivery") return "En profiter";
  return "Récupérer mon offre";
}

/**
 * Redimensionne/compresse une image côté client AVANT l'upload : borne la plus
 * grande dimension à 1600 px et ré-encode en JPEG qualité 0.85. Garantit qu'une
 * image énorme « s'intègre » sans alourdir le stockage ni casser l'affichage.
 */
export async function resizeImage(file: File): Promise<Blob> {
  const MAX = 1600;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.85)
  );
  return blob ?? file;
}

export const INPUT =
  "h-10 w-full rounded-control border border-border-strong bg-white px-3 text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-400 focus:outline-none";
export const LABEL = "text-foreground mb-1 block text-label font-bold";
