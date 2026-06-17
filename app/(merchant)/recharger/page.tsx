import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";

export const dynamic = "force-dynamic";

export default async function MerchantRechargerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="p-4 lg:p-6">
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
    </div>
  );
}
