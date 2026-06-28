import Link from "next/link";
import { HandCoins } from "lucide-react";
import { MerchantPayouts } from "@/components/admin/payouts/payouts-manager";
import { getMerchantPayouts } from "@/lib/data/admin-payouts";

export const dynamic = "force-dynamic";

// Onglet « Versements » du hub Commerçants : demandes de versement des
// commerçants (même composant + même action que /admin/versements, loader
// partagé getMerchantPayouts). Les partenaires restent côté Coligo Pay.
export default async function MerchantFinancesTab() {
  const payouts = await getMerchantPayouts();

  return (
    <div className="space-y-5">
      <p className="text-muted text-sm">
        Traitez les demandes de versement des commerçants. « Marquer payée »
        débite le solde — à faire <strong>après</strong> le virement réel.
      </p>
      <MerchantPayouts payouts={payouts} />
      <Link
        href="/admin/versements"
        className="border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
      >
        <HandCoins className="text-primary-500 size-4" />
        Verser les partenaires (Agents Coligo Pay) →
      </Link>
    </div>
  );
}
