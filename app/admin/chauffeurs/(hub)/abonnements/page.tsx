import { redirect } from "next/navigation";
import { getDrivePlans, getPriorityPass } from "./actions";
import { DrivePlansManager } from "@/components/admin/drive/drive-plans-manager";
import { PriorityPassManager } from "@/components/admin/drive/priority-pass-manager";

export const dynamic = "force-dynamic";

// Onglet « Abonnements » du hub Coligo Drive : gestion des plans (commission,
// cashback, prix, durée, avantages, badge, ordre d'affichage) + le Pass
// Prioritaire (abonnement visibilité commun livreurs + chauffeurs). Gate
// super-admin via getDrivePlans / getPriorityPass (adminCan « drive ») + le
// layout du hub.
export default async function DriveSubscriptionsTab() {
  const [plans, pass] = await Promise.all([getDrivePlans(), getPriorityPass()]);
  if (!plans || !pass) redirect("/admin");
  return (
    <div className="space-y-8">
      <DrivePlansManager initial={plans} />
      <PriorityPassManager initial={pass} />
    </div>
  );
}
