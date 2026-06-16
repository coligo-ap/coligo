import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DNav } from "@/components/chauffeur/d-ui";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { RechargePoints } from "@/components/wallet/recharge-points";

export const dynamic = "force-dynamic";

export default async function ChauffeurRechargerPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
      <RechargePoints />
      <DNav />
    </div>
  );
}
