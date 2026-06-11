import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DCompte } from "@/components/chauffeur/d-compte";
import { DBlocked, DFrozen } from "@/components/chauffeur/d-gate";

export const dynamic = "force-dynamic";

export default async function ChauffeurComptePage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  return <DCompte gate={gate} />;
}
