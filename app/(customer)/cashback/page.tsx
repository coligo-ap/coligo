import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
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

  const [balance, history, t] = await Promise.all([
    getMyCashbackBalance(),
    getMyCashbackHistory(100),
    getTranslations("wallet"),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 pb-24 lg:px-6">
        {/* HERO solde plein-cadre rectangulaire (bords droits, à ras du haut).
            Le titre est intégré dans le bandeau → plus de ligne d'en-tête séparée. */}
        <section className="from-primary-600 via-primary-700 to-primary-800 relative -mx-4 overflow-hidden bg-gradient-to-br px-4 pt-6 pb-7 text-white lg:-mx-6 lg:px-6 lg:pt-8 lg:pb-8">
          <Gift className="absolute -end-4 -top-4 size-32 text-white/10" />
          <p className="text-xs font-semibold tracking-wider text-white/85 uppercase">
            {t("cashbackTitle")} · {t("availableBalance")}
          </p>
          <p className="mt-1 text-4xl leading-none font-bold tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="text-primary-50/90 mt-3 max-w-md text-xs">
            {t.rich("cashbackNonWithdrawable", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
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
              {t("coligoPayLinkTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs">
              {t("coligoPayLinkDesc")}
            </p>
          </div>
        </Link>

        {/* Historique CASHBACK uniquement */}
        <section className="mt-6">
          <h2 className="text-foreground mb-3 text-base font-bold">
            {t("cashbackHistory")}
          </h2>
          <WalletEntryList
            entries={history}
            emptyHint={t("discoverMerchants")}
          />
        </section>
      </div>
    </CustomerShell>
  );
}
