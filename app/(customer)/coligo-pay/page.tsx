import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Gift, Wallet } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { WalletActions } from "@/components/customer/wallet-actions";
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

  const t = await getTranslations("wallet");

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 pb-24 lg:px-6">
        {/* HERO violet premium : grand solde + « argent réel ». */}
        <section className="from-primary-400 via-primary-600 to-primary-800 relative -mx-4 overflow-hidden bg-gradient-to-br px-5 pt-7 pb-7 text-white lg:-mx-6 lg:px-6 lg:pt-8 lg:pb-8">
          <Wallet className="absolute -end-7 -top-5 size-32 text-white/[.13]" />
          <span className="pointer-events-none absolute end-10 -bottom-12 size-32 rounded-full border border-white/10" />
          <p className="text-xs font-extrabold tracking-wider uppercase opacity-85">
            {t("coligoPayTitle")} · {t("coligoPayBalance")}
          </p>
          <p className="mt-1 text-[32px] leading-none font-black tracking-tight tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="mt-2.5 max-w-md text-[12.5px] leading-relaxed font-semibold opacity-90">
            {t("coligoPayBalanceDesc")}
          </p>
        </section>

        {/* Rangée d'actions wallet (façon Alipay) : Payer / Recevoir / Recharger */}
        <WalletActions
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />

        {/* Card info : Mon Cashback (différent de Coligo Pay) → page dédiée. */}
        <Link
          href="/cashback"
          className="mt-4 flex items-center gap-3 rounded-[18px] bg-white p-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)] transition-transform active:scale-[.99]"
        >
          <div className="flex size-[46px] shrink-0 items-center justify-center rounded-[13px] bg-amber-50 text-amber-600">
            <Gift className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-[14.5px] font-extrabold tracking-tight">
              {t("cashbackLinkTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("cashbackLinkDesc")}
            </p>
          </div>
        </Link>

        {/* Historique TOPUP uniquement (timeline) */}
        <section className="mt-6">
          <h2 className="text-foreground mb-2.5 text-[18px] font-black tracking-tight">
            {t("coligoPayHistory")}
          </h2>
          <WalletEntryList entries={history} emptyHint={t("rechargeNow")} />
        </section>
      </div>
    </CustomerShell>
  );
}
