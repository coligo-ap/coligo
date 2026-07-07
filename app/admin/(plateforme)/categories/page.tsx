import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { CategoriesManager } from "@/components/admin/plateforme/categories-manager";

export const dynamic = "force-dynamic";

// Onglet « Catégories » du hub Plateforme : types de commerce + filtres
// éditoriaux du marketplace (mig 0311-0313 + 0336) — reclassement (= ordre du
// strip marketplace), visibilité par surface (marketplace / inscription),
// statuts, images, création, mapping, suppression. Domaine « plateforme »
// exigé par le layout du hub ; re-gate super-admin ici (lecture service_role
// → self-guard obligatoire).
export default async function AdminCategoriesPage() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  // merchant_categories hors database.types.ts généré → accès casté.
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
                show_marketplace: boolean;
                show_signup: boolean;
              }[]
            | null;
        }>;
      };
    }
  )("merchant_categories")
    .select(
      "code, label, label_ar, emoji, image_url, status, position, kind, keywords, show_marketplace, show_signup"
    )
    .order("position", { ascending: true });

  // Comptages d'usage EXACTS via admin_category_usage (mig 0319) : plus de
  // plafond PostgREST à 1000 lignes, et le « secondaire » est calculé contre
  // merchants.category (pas contre `source`, qui peut être mal étiqueté).
  // links_total = la même définition que la garde serveur de suppression.
  const { data: usageRows, error: usageErr } = await admin.rpc(
    "admin_category_usage" as never
  );
  if (usageErr) throw new Error(usageErr.message);
  const usageByCat = new Map(
    (
      (usageRows ?? []) as unknown as {
        code: string;
        primary_count: number;
        secondary_count: number;
        links_total: number;
      }[]
    ).map((u) => [u.code, u])
  );
  const categories = (catRows ?? []).map((r) => {
    const u = usageByCat.get(r.code);
    return {
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
      showMarketplace: r.show_marketplace !== false,
      showSignup: r.show_signup !== false,
      merchants: Number(u?.primary_count ?? 0),
      links: Number(u?.secondary_count ?? 0),
      linksTotal: Number(u?.links_total ?? 0),
    };
  });

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-1">
        <h1 className="text-foreground text-xl font-extrabold">
          Catégories &amp; filtres
        </h1>
        <p className="text-muted mt-1 text-sm">
          Reclassez (glisser-déposer) : l&apos;ordre ci-dessous est celui du
          strip marketplace. Les chips « Marketplace » / « Inscription »
          contrôlent où chaque catégorie s&apos;affiche — appliqué côté serveur
          partout (strip, inscription, réglages boutique).
        </p>
      </header>
      <CategoriesManager categories={categories} />
    </div>
  );
}
