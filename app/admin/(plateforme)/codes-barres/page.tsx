import { createAdminClient } from "@/lib/supabase/admin";
import { BarcodeManager } from "@/components/admin/barcode-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/codes-barres — gestion du catalogue de la recherche par CODE-BARRES :
//   • catalogue local (saisie admin PRIORITAIRE + auto-enrichi OpenFoodFacts) ;
//   • scans NON RÉSOLUS récents (à enrichir en un clic) ;
//   • activation par surface : onglet « Contrôle services » (feature flags).
// Gate domaine « plateforme » : layout du hub. Lectures via service_role
// (tables sans policy RLS) — self-guard : données de plateforme, pas de tenant.
// =============================================================================

type CatalogRow = {
  barcode: string;
  product_name: string;
  brand: string | null;
  source: "admin" | "openfoodfacts";
  updated_at: string;
};

type UnresolvedRow = {
  barcode: string;
  n: number;
  last_at: string;
};

export default async function AdminBarcodesPage() {
  const admin = createAdminClient();

  const [{ data: catalog }, { data: scans }] = await Promise.all([
    admin
      .from("barcode_catalog" as never)
      .select("barcode, product_name, brand, source, updated_at")
      .order("updated_at", { ascending: false })
      .limit(300),
    // Scans non résolus des 30 derniers jours (regroupés côté Node : volumes
    // faibles à ce stade, pas besoin d'une RPC dédiée).
    admin
      .from("barcode_scan_log" as never)
      .select("barcode, created_at")
      .eq("resolved", false)
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const byCode = new Map<string, UnresolvedRow>();
  for (const s of (scans ?? []) as { barcode: string; created_at: string }[]) {
    const cur = byCode.get(s.barcode);
    if (cur) cur.n += 1;
    else
      byCode.set(s.barcode, {
        barcode: s.barcode,
        n: 1,
        last_at: s.created_at,
      });
  }
  // Les codes depuis résolus (présents au catalogue) ne sont plus « à faire ».
  const known = new Set(
    ((catalog ?? []) as CatalogRow[]).map((c) => c.barcode)
  );
  const unresolved = [...byCode.values()]
    .filter((u) => !known.has(u.barcode))
    .sort((a, b) => b.n - a.n)
    .slice(0, 50);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 lg:px-6">
      <BarcodeManager
        catalog={(catalog ?? []) as CatalogRow[]}
        unresolved={unresolved}
      />
    </div>
  );
}
