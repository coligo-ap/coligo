import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
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
      <div className="mb-3 flex items-center gap-2">
        <Link
          href="/chauffeur"
          aria-label="Retour"
          className="grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="drive-sora text-[19px] font-extrabold tracking-[-0.5px]">
          Mon portefeuille
        </h1>
      </div>
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
      <RechargePoints />
      <DNav />
    </div>
  );
}
