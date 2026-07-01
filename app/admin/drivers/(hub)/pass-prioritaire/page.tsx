import { redirect } from "next/navigation";
import { getPriorityPass } from "@/app/admin/chauffeurs/(hub)/abonnements/actions";
import { PriorityPassManager } from "@/components/admin/drive/priority-pass-manager";

export const dynamic = "force-dynamic";

// Onglet « Pass Prioritaire » du hub Livraison. Même carte que le hub Drive : le
// Pass Prioritaire est un abonnement UNIQUE commun livreurs + chauffeurs (source
// de vérité partagée dans platform_settings). Gate super-admin via getPriorityPass
// (drive OU livraison) + le layout du hub.
export default async function DeliveryPriorityPassTab() {
  const pass = await getPriorityPass();
  if (!pass) redirect("/admin");
  return <PriorityPassManager initial={pass} />;
}
