import { RechargesView } from "@/components/admin/recharges/recharges-view";

export const dynamic = "force-dynamic";

// Route transverse conservée (l'accès super-admin + MFA est garanti par
// app/admin/layout.tsx). Même vue que l'onglet Recharges du hub Coligo Pay &
// Finances (/admin/coligo-pay/recharges) via le composant partagé RechargesView.
export default function AdminRechargesPage() {
  return <RechargesView />;
}
