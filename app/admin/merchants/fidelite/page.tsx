import { createClient } from "@/lib/supabase/server";
import {
  LoyaltyBoundsForm,
  type LoyaltyBounds,
} from "@/components/admin/merchants/loyalty-bounds-form";
import {
  LoyaltyCardsConsole,
  type LoyaltyBatchRow,
} from "@/components/admin/merchants/loyalty-cards-console";
import { LoyaltyCardTool } from "@/components/admin/merchants/loyalty-card-tool";

export const dynamic = "force-dynamic";

// Onglet « Fidélité » du hub Commerçants — le super-admin a TOUTE la main :
//   1. GÉNÉRATION des lots de cartes physiques (modèle visuel au choix,
//      quantité bornée) + PDF d'impression 85,6 × 54 mm retéléchargeable à
//      tout moment (régénéré à la volée, jamais stocké) + journal des lots ;
//   2. SUPPORT carte : recherche, blocage/déblocage, transfert de solde ;
//   3. BORNES plateforme des programmes commerçants.
// Gate domaine : layout du hub (requireAdminDomain("commercants")).
export default async function AdminLoyaltyTab() {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>;

  // Recherche d'abord (règle annuaires) : AUCUN chargement en masse des
  // commerçants — le picker interroge admin_loyalty_search_merchants (0458).
  const [{ data: bounds }, { data: batches }] = await Promise.all([
    rpc("admin_loyalty_settings") as Promise<{
      data: LoyaltyBounds | null;
      error: unknown;
    }>,
    rpc("admin_loyalty_batches", { p_limit: 20 }) as Promise<{
      data: LoyaltyBatchRow[] | null;
      error: unknown;
    }>,
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-bold">Fidélité</h1>
        <p className="text-muted mt-1 text-sm">
          Cartes physiques (lots + PDF d&apos;impression), support carte et
          bornes des programmes. Le drapeau de lancement se pilote dans
          Plateforme → Contrôle des services.
        </p>
      </header>

      <LoyaltyCardsConsole
        batches={batches ?? []}
        maxBatch={Number(bounds?.max_batch_quantity ?? 1000)}
      />

      <LoyaltyCardTool />

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold">Bornes plateforme</h2>
          <p className="text-muted mt-0.5 text-sm">
            Les commerçants configurent leur programme uniquement à
            l&apos;intérieur de ces bornes (RPC + trigger DB).
          </p>
        </div>
        {bounds ? (
          <LoyaltyBoundsForm bounds={bounds} />
        ) : (
          <p className="text-danger-600 text-sm">
            Impossible de charger les bornes. Rechargez la page.
          </p>
        )}
      </section>
    </div>
  );
}
