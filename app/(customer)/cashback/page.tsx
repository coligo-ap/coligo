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
        {/* HERO violet premium : grand solde + rappel « non retirable ». */}
        <section className="from-primary-400 via-primary-600 to-primary-800 relative -mx-4 overflow-hidden bg-gradient-to-br px-5 pt-7 pb-7 text-white lg:-mx-6 lg:px-6 lg:pt-8 lg:pb-8">
          <Gift className="absolute -end-7 -top-5 size-32 text-white/[.13]" />
          <span className="pointer-events-none absolute end-10 -bottom-12 size-32 rounded-full border border-white/10" />
          <p className="text-xs font-extrabold tracking-wider uppercase opacity-85">
            {t("cashbackTitle")} · {t("availableBalance")}
          </p>
          <p className="mt-1 text-[32px] leading-none font-black tracking-tight tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="mt-2.5 max-w-md text-[12.5px] leading-relaxed font-semibold opacity-90">
            {t.rich("cashbackNonWithdrawable", {
              strong: (chunks) => (
                <strong className="font-extrabold">{chunks}</strong>
              ),
            })}
          </p>
        </section>

        {/* Card info : Coligo Pay (différent du cashback) → page dédiée. */}
        <Link
          href="/coligo-pay"
          className="mt-4 flex items-center gap-3 rounded-[18px] bg-white p-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)] transition-transform active:scale-[.99]"
        >
          <div className="bg-primary-50 text-primary-600 flex size-[46px] shrink-0 items-center justify-center rounded-[13px]">
            <Wallet className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-[14.5px] font-extrabold tracking-tight">
              {t("coligoPayLinkTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("coligoPayLinkDesc")}
            </p>
          </div>
        </Link>

        {/* Historique CASHBACK uniquement (timeline) */}
        <section className="mt-6">
          <h2 className="text-foreground mb-2.5 text-[18px] font-black tracking-tight">
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
