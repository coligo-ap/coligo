import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DNav } from "@/components/chauffeur/d-ui";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";

export const dynamic = "force-dynamic";

export default async function ChauffeurRechargerPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-page)] px-5 pt-4 pb-24">
      <div className="mb-1 flex items-center gap-2">
        <Link
          href="/chauffeur"
          aria-label="Retour"
          className="grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
        >
          <ChevronLeft className="size-5" />
        </Link>
      </div>
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
      <DNav />
    </div>
  );
}
