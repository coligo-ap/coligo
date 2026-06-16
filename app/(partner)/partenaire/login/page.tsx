import { redirect } from "next/navigation";
import { Store } from "lucide-react";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerLoginForm } from "@/components/partner/login-form";

export const dynamic = "force-dynamic";

export default async function PartnerLoginPage() {
  const partner = await getCurrentPartner();
  if (partner) redirect("/partenaire");
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <span className="bg-primary-600 mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl text-white">
          <Store className="size-6" />
        </span>
        <h1 className="text-foreground text-xl font-bold">
          Point de recharge Coligo
        </h1>
        <p className="text-muted mt-1 text-sm">
          Connectez-vous pour gérer votre solde et vos ventes de crédit.
        </p>
      </div>
      <div className="border-border bg-surface rounded-[16px] border p-5 shadow-sm">
        <PartnerLoginForm />
      </div>
    </div>
  );
}
