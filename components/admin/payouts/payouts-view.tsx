import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  PayoutsManager,
  type PartnerPayable,
} from "@/components/admin/payouts/payouts-manager";
import { getMerchantPayouts } from "@/lib/data/admin-payouts";

// =============================================================================
// Vue Versements (demandes commerçants + partenaires Agents Coligo Pay) —
// partagée entre la route transverse /admin/versements et l'onglet Versements
// du hub Coligo Pay & Finances (/admin/coligo-pay/versements). Aucune logique
// métier modifiée. Gate super-admin via le layout /admin ET re-gardé ici
// (service_role) car vue « partagée » (mémoïsé, coût réseau nul).
// =============================================================================
export async function PayoutsView() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string
  ) => Promise<{ data: unknown }>;

  const [payouts, partnersRes] = await Promise.all([
    getMerchantPayouts(),
    rpc("admin_partner_payables"),
  ]);

  const partners = (partnersRes.data as PartnerPayable[] | null) ?? [];

  return <PayoutsManager payouts={payouts} partners={partners} />;
}
