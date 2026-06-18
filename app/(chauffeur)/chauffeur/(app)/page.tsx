import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DHome } from "@/components/chauffeur/d-home";
import { DBlocked, DFrozen, DWait } from "@/components/chauffeur/d-gate";

export const dynamic = "force-dynamic";

/**
 * Accueil chauffeur — gating maquette : pending (docs → attente validation
 * super admin) → active → frozen (gel) / blocked.
 */
export default async function ChauffeurPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  if (!gate.submitted) redirect("/chauffeur/documents");
  if (!gate.isVerified) return <DWait />;
  return <DHome gate={gate} />;
}
