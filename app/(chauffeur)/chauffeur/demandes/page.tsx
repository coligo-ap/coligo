import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DRequests } from "@/components/chauffeur/d-requests";
import { DBlocked, DFrozen, DWait } from "@/components/chauffeur/d-gate";

export const dynamic = "force-dynamic";

export default async function ChauffeurDemandesPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  if (!gate.submitted) redirect("/chauffeur/documents");
  if (!gate.isVerified) return <DWait />;
  return <DRequests />;
}
