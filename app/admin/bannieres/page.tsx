import { createAdminClient } from "@/lib/supabase/admin";
import { BannersManager } from "@/components/admin/bannieres/banners-manager";
import type { AdminBanner } from "@/components/admin/bannieres/banners-manager";

export const dynamic = "force-dynamic";

// L'accès super-admin (+ MFA) est garanti par app/admin/layout.tsx.
export default async function AdminBannersPage() {
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
      "id, title, subtitle, cta_label, image_url, link, accent, position, active, starts_at, ends_at"
    )
    .order("position", { ascending: true });

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

      <BannersManager banners={(data ?? []) as AdminBanner[]} />
    </div>
  );
}
