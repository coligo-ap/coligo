import { PayoutsView } from "@/components/admin/payouts/payouts-view";

export const dynamic = "force-dynamic";

// Route transverse conservée (l'accès super-admin + MFA est garanti par
// app/admin/layout.tsx). Même vue que l'onglet Versements du hub Coligo Pay &
// Finances (/admin/coligo-pay/versements) via le composant partagé PayoutsView.
export default function AdminVersementsPage() {
  return <PayoutsView />;
}
