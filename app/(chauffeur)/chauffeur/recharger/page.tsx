import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DNav, DBack } from "@/components/chauffeur/d-ui";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";

export const dynamic = "force-dynamic";

export default async function ChauffeurRechargerPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-page)] px-5 pt-4 pb-24">
      <div className="mb-1 flex items-center gap-2">
        <DBack />
      </div>
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
      <DNav />
    </div>
  );
}
