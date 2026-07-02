import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  BannersManager,
  type AdminBanner,
} from "@/components/admin/bannieres/banners-manager";
import { CategoryFilterImages } from "@/components/admin/bannieres/category-filter-images";

// =============================================================================
// Vue Bannières éditoriales — partagée entre la route transverse
// /admin/bannieres et l'onglet Bannières du hub Marketing (/admin/marketing).
// Aucune logique métier modifiée. Gate super-admin via le layout /admin ET
// re-gardé ici (service_role) : vue « partagée » → self-guard obligatoire pour
// ne jamais lire en service_role hors d'une session super-admin (mémoïsé par
// requête, coût réseau nul).
// =============================================================================
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
      "id, title, subtitle, cta_label, image_url, image_fit, link, accent, position, active, starts_at, ends_at"
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
  const banners = ((data ?? []) as AdminBanner[]).map((b) => ({
    ...b,
    zones: zonesByBanner.get(b.id) ?? [],
  }));

  // Catégories pilotées en base (mig 0311) + nb de commerçants par catégorie
  // (garde de suppression) — tables hors types générés → accès casté.
  const { data: catRows } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          col: string,
          o: { ascending: boolean }
        ) => Promise<{
          data:
            | {
                code: string;
                label: string;
                label_ar: string;
                emoji: string;
                image_url: string | null;
                status: string;
                kind: string;
                keywords: string[] | null;
              }[]
            | null;
        }>;
      };
    }
  )("merchant_categories")
    .select(
      "code, label, label_ar, emoji, image_url, status, position, kind, keywords"
    )
    .order("position", { ascending: true });
  const { data: merchCats } = await admin.from("merchants").select("category");
  const countByCat = new Map<string, number>();
  for (const m of merchCats ?? []) {
    const k = (m as { category: string | null }).category ?? "";
    if (k) countByCat.set(k, (countByCat.get(k) ?? 0) + 1);
  }
  const adminCategories = (catRows ?? []).map((r) => ({
    code: r.code,
    label: r.label,
    labelAr: r.label_ar,
    emoji: r.emoji,
    imageUrl: r.image_url,
    status: (r.status === "hidden" || r.status === "coming_soon"
      ? r.status
      : "active") as "active" | "hidden" | "coming_soon",
    kind: (r.kind === "filter" ? "filter" : "type") as "type" | "filter",
    keywords: r.keywords ?? [],
    merchants: countByCat.get(r.code) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Bannières éditoriales
        </h1>
        <p className="text-muted mt-1 text-sm">
          Mises en avant affichées en haut de l&apos;accueil client (carrousel).
          Purement visuel — sans lien avec les codes promo. Les bannières
          inactives ou hors fenêtre de dates ne sont pas affichées.
        </p>
      </header>

      <BannersManager banners={banners} />

      {/* Catégories & filtres du marketplace (mig 0311) : statuts, images,
          création, suppression. */}
      <CategoryFilterImages categories={adminCategories} />
    </div>
  );
}
