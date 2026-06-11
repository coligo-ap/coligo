import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DSubs } from "@/components/chauffeur/d-subs";
import { DBlocked, DFrozen } from "@/components/chauffeur/d-gate";

export const dynamic = "force-dynamic";

export default async function ChauffeurAbonnementPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  // Suspense : requis par useSearchParams (retour ?card=… de Chargily).
  return (
    <Suspense fallback={null}>
      <DSubs />
    </Suspense>
  );
}
