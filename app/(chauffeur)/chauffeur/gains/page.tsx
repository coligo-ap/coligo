import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DGains } from "@/components/chauffeur/d-gains";
import { DBlocked, DFrozen, DWait } from "@/components/chauffeur/d-gate";

export const dynamic = "force-dynamic";

export default async function ChauffeurGainsPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  if (!gate.isVerified) return <DWait />;
  return <DGains />;
}
