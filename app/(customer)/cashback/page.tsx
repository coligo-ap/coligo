import { redirect } from "next/navigation";
import Link from "next/link";
import { Gift, Wallet } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { formatDA } from "@/lib/utils";
import {
  getMyCashbackBalance,
  getMyCashbackHistory,
} from "@/lib/customer/cashback";
import { WalletEntryList } from "@/components/customer/wallet/entry-list";

export const dynamic = "force-dynamic";

export default async function CustomerCashbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/cashback");

  // Commerçant qui tape /cashback par erreur → renvoyé sur son dashboard.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const [balance, history] = await Promise.all([
    getMyCashbackBalance(),
    getMyCashbackHistory(100),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-6 pb-24 lg:px-6 lg:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Mon Cashback
          </h1>
          <p className="text-muted mt-1 text-sm">
            Gagnez du cashback à chaque commande, utilisez-le pour payer vos
            prochaines.
          </p>
        </header>

        {/* Solde principal */}
        <section className="from-primary-600 via-primary-700 to-primary-800 relative overflow-hidden rounded-[20px] bg-gradient-to-br p-6 text-white shadow-md">
          <Gift className="absolute -top-2 -right-2 size-28 text-white/10" />
          <p className="text-xs font-semibold tracking-wider text-white/85 uppercase">
            Solde disponible
          </p>
          <p className="mt-1 text-4xl leading-none font-bold tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="text-primary-50/85 mt-3 max-w-md text-xs">
            Ce cashback est <strong>non retirable</strong>. Il se déduit
            automatiquement de tes prochaines commandes.
          </p>
        </section>

        {/* Renvoi vers la page Coligo Pay (distincte du cashback) */}
        <Link
          href="/coligo-pay"
          className="border-border bg-surface hover:border-primary-300 mt-4 flex items-center gap-3 rounded-[16px] border p-4 transition-colors"
        >
          <div className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-full">
            <Wallet className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-semibold">
              Coligo Pay (différent du cashback)
            </p>
            <p className="text-muted mt-0.5 text-xs">
              Solde réel rechargeable par carte CIB/EDAHABIA. Voir et recharger
              →
            </p>
          </div>
        </Link>

        {/* Historique CASHBACK uniquement */}
        <section className="mt-6">
          <h2 className="text-foreground mb-3 text-base font-bold">
            Historique du cashback
          </h2>
          <WalletEntryList
            entries={history}
            emptyHint="Découvrir les commerces"
          />
        </section>
      </div>
    </CustomerShell>
  );
}
