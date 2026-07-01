import { redirect } from "next/navigation";
import { getDrivePlans } from "./actions";
import { DrivePlansManager } from "@/components/admin/drive/drive-plans-manager";

export const dynamic = "force-dynamic";

// Onglet « Abonnements » du hub Coligo Drive : gestion des plans (commission,
// cashback, prix, durée, avantages, badge, ordre d'affichage). Gate super-admin
// via getDrivePlans (adminCan « drive ») + le layout du hub.
export default async function DriveSubscriptionsTab() {
  const plans = await getDrivePlans();
  if (!plans) redirect("/admin");
  return <DrivePlansManager initial={plans} />;
}
