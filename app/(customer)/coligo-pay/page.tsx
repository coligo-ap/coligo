import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight, Gift, Wallet } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { WalletActions } from "@/components/customer/wallet-actions";
import { MyPayTag } from "@/components/customer/my-pay-tag";
import { WalletEntryList } from "@/components/customer/wallet/entry-list";
import { getMyPayHandle } from "@/app/(customer)/coligo-pay/qr/actions";
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

  const [t, tAccount, payTag] = await Promise.all([
    getTranslations("wallet"),
    getTranslations("account"),
    getMyPayHandle(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 pt-2 pb-24 lg:px-6">
        <Link
          href="/compte"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {tAccount("myAccount")}
        </Link>

        {/* HERO premium : carte arrondie flottante (solde + identité). */}
        <section className="from-primary-400 via-primary-600 to-primary-800 relative overflow-hidden rounded-[26px] bg-gradient-to-br px-6 pt-6 pb-12 text-white shadow-[0_22px_50px_-22px_rgba(91,91,230,.65)]">
          {/* anneaux décoratifs */}
          <span className="pointer-events-none absolute -end-12 -top-16 size-52 rounded-full border border-white/12" />
          <span className="pointer-events-none absolute end-6 -top-6 size-32 rounded-full border border-white/10" />

          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-white/20 backdrop-blur">
              <Wallet className="size-4" />
            </span>
            <span className="text-[12.5px] font-extrabold tracking-wide uppercase opacity-90">
              {t("coligoPayTitle")}
            </span>
          </div>

          <p className="mt-4 text-[12px] font-bold tracking-wide uppercase opacity-75">
            {t("coligoPayBalance")}
          </p>
          <p className="mt-0.5 text-[40px] leading-none font-black tracking-tight tabular-nums">
            {formatDA(balance)}
          </p>
          <p className="mt-2.5 max-w-md text-[12px] leading-relaxed font-medium opacity-85">
            {t("coligoPayBalanceDesc")}
          </p>

          {/* Identifiant (tag) à partager pour recevoir — intégré au hero. */}
          {payTag?.handle && (
            <MyPayTag handle={payTag.handle} name={payTag.name} />
          )}
        </section>

        {/* Actions unifiées (chevauchent le bas du hero) */}
        <WalletActions
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />

        {/* Lien cashback ÉPURÉ (ligne fine, plus une grosse carte). */}
        <Link
          href="/cashback"
          className="hover:bg-surface-2 mt-4 flex items-center gap-3 rounded-[16px] px-1.5 py-1 transition-colors"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Gift className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-[14px] font-extrabold tracking-tight">
              {t("cashbackLinkTitle")}
            </p>
            <p className="text-muted truncate text-xs font-medium">
              {t("cashbackLinkDesc")}
            </p>
          </div>
          <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
        </Link>

        {/* Historique TOPUP (timeline) */}
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
