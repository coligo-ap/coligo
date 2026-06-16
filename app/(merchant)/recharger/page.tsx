import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { RechargePoints } from "@/components/wallet/recharge-points";

export const dynamic = "force-dynamic";

export default async function MerchantRechargerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
      <RechargePoints />
    </div>
  );
}
