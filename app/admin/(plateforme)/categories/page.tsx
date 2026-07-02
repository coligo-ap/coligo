import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { CategoryFilterImages } from "@/components/admin/plateforme/category-filter-images";

export const dynamic = "force-dynamic";

// Onglet « Catégories » du hub Plateforme : types de commerce + filtres
// éditoriaux du marketplace (mig 0311-0313) — statuts, images, création,
// mapping, suppression. Domaine « plateforme » exigé par le layout du hub ;
// re-gate super-admin ici (lecture service_role → self-guard obligatoire).
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

  // Nb de commerçants par catégorie PRINCIPALE (garde de suppression).
  const { data: merchCats } = await admin.from("merchants").select("category");
  const countByCat = new Map<string, number>();
  for (const m of merchCats ?? []) {
    const k = (m as { category: string | null }).category ?? "";
    if (k) countByCat.set(k, (countByCat.get(k) ?? 0) + 1);
  }
  const categories = (catRows ?? []).map((r) => ({
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
      <header className="mb-1">
        <h1 className="text-foreground text-xl font-extrabold">
          Catégories &amp; filtres
        </h1>
        <p className="text-muted mt-1 text-sm">
          Types de commerce (inscription + filtre marketplace) et filtres
          éditoriaux. Le statut est appliqué côté serveur partout (inscription,
          strip de filtres, visibilité des commerces).
        </p>
      </header>
      <CategoryFilterImages categories={categories} />
    </div>
  );
}
