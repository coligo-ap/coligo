import { RechargesView } from "@/components/admin/recharges/recharges-view";

export const dynamic = "force-dynamic";

// Onglet « Recharges » du hub Coligo Pay & Finances (composant partagé avec la
// route transverse /admin/recharges).
export default function FinancesRechargesTab() {
  return <RechargesView />;
}
