import { redirect } from "next/navigation";
import Link from "next/link";
import { Gift, Wallet } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { ColigoPayCard } from "@/components/customer/coligo-pay-card";
import { WalletEntryList } from "@/components/customer/wallet/entry-list";
import { createClient } from "@/lib/supabase/server";
import { formatDA } from "@/lib/utils";
import {
  getMyTopupBalance,
  getMyTopupHistory,
  getTopupCreditedLast30dForCustomer,
} from "@/lib/customer/cashback";

export const dynamic = "force-dynamic";

// =============================================================================
// /coligo-pay — page dédiée au SOLDE RÉEL (rechargeable par Chargily).
// =============================================================================
// Séparée volontairement de /cashback pour éviter toute confusion entre les
// deux "poches" :
//   - cashback   : récompense, non retirable, calculé sur les achats
//   - Coligo Pay : argent réel déposé par le client par carte CIB/EDAHABIA
//
// Les écritures historiques sont filtrées sur source='topup' (cf.
// getMyTopupHistory) — aucune ligne cashback ne polluera cette page.
// =============================================================================
export default async function CustomerColigoPayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/coligo-pay");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("max_topup_da_per_30d")
    .eq("id", true)
    .maybeSingle();
  const maxPerRecharge = settings?.max_topup_da_per_30d ?? 50000;

  const [balance, credited30d, history] = await Promise.all([
    getMyTopupBalance(),
    customer
      ? getTopupCreditedLast30dForCustomer(customer.id)
      : Promise.resolve(0),
    getMyTopupHistory(100),
  ]);
  const remaining30d = Math.max(0, maxPerRecharge - credited30d);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-6 pb-24 lg:px-6 lg:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Coligo Pay
          </h1>
          <p className="text-muted mt-1 text-sm">
            Ton solde réel rechargeable par carte CIB / EDAHABIA via Chargily
            Pay.
          </p>
        </header>

        {/* Solde principal — visuellement DIFFÉRENT du cashback (gradient
            différent + icône Wallet) pour éviter la confusion à l'œil. */}
        <section className="from-primary-700 to-primary-900 relative overflow-hidden rounded-[20px] bg-gradient-to-br p-6 text-white shadow-md">
          <Wallet className="absolute -top-2 -right-2 size-28 text-white/10" />
          <p className="text-xs font-semibold tracking-wider text-white/85 uppercase">
            Solde Coligo Pay
          </p>
          <p className="mt-1 text-4xl leading-none font-bold tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="text-primary-50/85 mt-3 max-w-md text-xs">
            Argent réel — utilisable comme moyen de paiement à n&apos;importe
            quel commerce Coligo (en plus de ton cashback). Tu peux le recharger
            ci-dessous.
          </p>
        </section>

        {/* Bouton de recharge (modale presets + libre) */}
        <ColigoPayCard
          balanceDa={balance}
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />

        {/* Renvoi vers le cashback */}
        <Link
          href="/cashback"
          className="border-border bg-surface hover:border-primary-300 mt-4 flex items-center gap-3 rounded-[16px] border p-4 transition-colors"
        >
          <div className="bg-primary-100 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-full">
            <Gift className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-semibold">
              Mon Cashback (différent de Coligo Pay)
            </p>
            <p className="text-muted mt-0.5 text-xs">
              Récompense gagnée sur tes achats, non retirable. Voir →
            </p>
          </div>
        </Link>

        {/* Historique TOPUP uniquement */}
        <section className="mt-6">
          <h2 className="text-foreground mb-3 text-base font-bold">
            Historique Coligo Pay
          </h2>
          <WalletEntryList entries={history} emptyHint="Recharger maintenant" />
        </section>
      </div>
    </CustomerShell>
  );
}
