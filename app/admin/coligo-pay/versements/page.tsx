import { PayoutsView } from "@/components/admin/payouts/payouts-view";

export const dynamic = "force-dynamic";

// Onglet « Versements » du hub Coligo Pay & Finances (composant partagé avec la
// route transverse /admin/versements).
export default function FinancesVersementsTab() {
  return <PayoutsView />;
}
