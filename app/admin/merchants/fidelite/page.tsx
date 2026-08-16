import { createClient } from "@/lib/supabase/server";
import {
  LoyaltyBoundsForm,
  type LoyaltyBounds,
} from "@/components/admin/merchants/loyalty-bounds-form";

export const dynamic = "force-dynamic";

// Onglet « Fidélité » du hub Commerçants : BORNES plateforme du programme
// (taux min/max, paliers, plafonds, validité des bons, taille des lots).
// Chaque commerçant règle ensuite SON programme à l'intérieur de ces bornes —
// une valeur hors bornes est refusée par la RPC ET le trigger DB.
// Gate domaine : layout du hub (requireAdminDomain("commercants")).
// La génération des lots de cartes PDF arrivera ici (Phase 4 du chantier).
export default async function AdminLoyaltyTab() {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string
  ) => Promise<{ data: LoyaltyBounds | null; error: unknown }>;
  const { data: bounds } = await rpc("admin_loyalty_settings");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">Fidélité — bornes plateforme</h1>
        <p className="text-muted mt-1 text-sm">
          Les commerçants configurent leur programme (cashback, paliers, bons)
          uniquement à l&apos;intérieur de ces bornes. Le drapeau de lancement
          se pilote dans Plateforme → Contrôle des services.
        </p>
      </header>
      {bounds ? (
        <LoyaltyBoundsForm bounds={bounds} />
      ) : (
        <p className="text-danger-600 text-sm">
          Impossible de charger les bornes. Rechargez la page.
        </p>
      )}
    </div>
  );
}
