import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  BannersManager,
  type AdminBanner,
} from "@/components/admin/bannieres/banners-manager";

// =============================================================================
// Vue Bannières éditoriales — partagée entre la route transverse
// /admin/bannieres et l'onglet Bannières du hub Marketing (/admin/marketing).
// Aucune logique métier modifiée. Gate super-admin via le layout /admin ET
// re-gardé ici (service_role) : vue « partagée » → self-guard obligatoire pour
// ne jamais lire en service_role hors d'une session super-admin (mémoïsé par
// requête, coût réseau nul).
// =============================================================================

type OfferRow = {
  id: string;
  type:
    | "product_discount"
    | "promo_code"
    | "quantity_offer"
    | "free_gift"
    | "free_delivery"
    | "flash_sale"
    | "anti_gaspillage";
  title_fr: string;
  status: string;
  discount_kind: "percent" | "amount" | null;
  discount_value: number | string | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  gift_label: string | null;
};

/** Résumé court d'une offre pour la liste/édition admin (« Code -20% », etc.). */
function summarizeOffer(o: OfferRow): string {
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
  return val ? `Réduction ${money(val)}` : "Réduction";
}

export async function BannersView() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  // promo_banners hors database.types.ts généré → accès casté.
  type Selectable = {
    select: (c: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{ data: unknown }>;
    };
  };
  const { data } = await (admin.from as unknown as (t: string) => Selectable)(
    "promo_banners"
  )
    .select(
      "id, title, subtitle, cta_label, image_url, image_fit, overlay_opacity, link, accent, position, active, starts_at, ends_at, promotion_id, merchant_id, geo_radius_km"
    )
    .order("position", { ascending: true });

  // Zones de ciblage (mig 0249) — chargées en bloc puis regroupées par bannière.
  type ZoneRow = {
    banner_id: string;
    label: string | null;
    center_lat: number | null;
    center_lng: number | null;
    radius_km: number | null;
  };
  const { data: zoneData } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => Promise<{ data: ZoneRow[] | null }>;
    }
  )("promo_banner_zones").select(
    "banner_id, label, center_lat, center_lng, radius_km"
  );
  const zonesByBanner = new Map<string, AdminBanner["zones"]>();
  for (const z of zoneData ?? []) {
    if (z.center_lat == null || z.center_lng == null || z.radius_km == null)
      continue;
    const arr = zonesByBanner.get(z.banner_id) ?? [];
    arr.push({
      label: z.label ?? "",
      center_lat: z.center_lat,
      center_lng: z.center_lng,
      radius_km: Number(z.radius_km),
    });
    zonesByBanner.set(z.banner_id, arr);
  }
  // Bannières « offre commerçant » (mig 0330) : on résout le nom du commerçant
  // et un résumé de l'offre pour l'affichage de la liste + le pré-remplissage du
  // formulaire d'édition. `promotions`/`merchants` sont typés → accès direct.
  type RawBanner = Omit<AdminBanner, "zones"> & {
    promotion_id: string | null;
    merchant_id: string | null;
    geo_radius_km: number | string | null;
    overlay_opacity: number | string | null;
  };
  const raw = (data ?? []) as RawBanner[];
  const merchantIds = [
    ...new Set(raw.map((b) => b.merchant_id).filter((x): x is string => !!x)),
  ];
  const promotionIds = [
    ...new Set(raw.map((b) => b.promotion_id).filter((x): x is string => !!x)),
  ];
  const [{ data: mRows }, { data: pRows }] = await Promise.all([
    merchantIds.length
      ? admin.from("merchants").select("id, name, slug").in("id", merchantIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; slug: string }[],
        }),
    promotionIds.length
      ? admin
          .from("promotions")
          .select(
            "id, type, title_fr, status, discount_kind, discount_value, code, buy_qty, get_qty, gift_label"
          )
          .in("id", promotionIds)
      : Promise.resolve({ data: [] as OfferRow[] }),
  ]);
  const merchantById = new Map(
    ((mRows ?? []) as { id: string; name: string; slug: string }[]).map((m) => [
      m.id,
      m,
    ])
  );
  const offerById = new Map(
    ((pRows ?? []) as OfferRow[]).map((p) => [p.id, p])
  );

  const banners = raw.map((b) => {
    const m = b.merchant_id ? merchantById.get(b.merchant_id) : null;
    const o = b.promotion_id ? offerById.get(b.promotion_id) : null;
    return {
      ...b,
      geo_radius_km: b.geo_radius_km != null ? Number(b.geo_radius_km) : null,
      overlay_opacity:
        b.overlay_opacity != null ? Number(b.overlay_opacity) : 30,
      zones: zonesByBanner.get(b.id) ?? [],
      merchant_name: m?.name ?? null,
      merchant_slug: m?.slug ?? null,
      offer_summary: o ? summarizeOffer(o) : null,
      offer_active: o ? o.status === "active" : null,
    } satisfies AdminBanner;
  });

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Bannières marketing
        </h1>
        <p className="text-muted mt-1 text-sm">
          Mises en avant affichées en haut de l&apos;accueil client (carrousel).
          Deux types : <b>éditoriale</b> (visuel + lien libre) ou{" "}
          <b>offre d&apos;un commerçant</b> — mise en avant d&apos;une promotion
          réelle du commerçant. Coligo ne crée pas l&apos;offre : elle est relue
          en direct et le ciblage suit la zone du commerçant. Si le commerçant
          la désactive, la bannière disparaît. Les bannières inactives ou hors
          fenêtre de dates ne sont pas affichées.
        </p>
      </header>

      {/* Cible de l'alerte « bannières expirées encore actives » (?focus=…). */}
      <div data-alert-focus="banners_expired" className="rounded-[16px]">
        <BannersManager banners={banners} />
      </div>
    </div>
  );
}
