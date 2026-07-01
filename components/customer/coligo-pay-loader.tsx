"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Gift, Wallet } from "lucide-react";
import { fetchColigoPayData } from "@/app/(customer)/coligo-pay/actions";
import { WalletActions } from "@/components/customer/wallet-actions";
import { MyPayTag } from "@/components/customer/my-pay-tag";
import { WalletEntryList } from "@/components/customer/wallet/entry-list";
import { WalletBalanceValue } from "@/components/customer/wallet/balance-value";

/**
 * Contenu de /coligo-pay via TanStack Query (pattern OrdersLoader). Le RSC ne
 * fait plus que les gardes (auth + flag) ; ici les données (solde, plafond,
 * historique, tag) viennent du cache PERSISTANT → au retour sur l'écran tout
 * s'affiche INSTANTANÉMENT puis se rafraîchit en silence (plus de rechargement
 * complet à chaque navigation).
 *
 * Le solde du hero réutilise le cache PARTAGÉ `wallet-balances` (même clé que
 * /compte) : passer de Compte à Pay affiche le montant sans attendre.
 */
export function ColigoPayLoader({ userId }: { userId: string }) {
  const t = useTranslations("wallet");
  const router = useRouter();
  // Retour INTELLIGENT : revient là où l'utilisateur était juste avant (pile de
  // navigation) ; sinon, repli sur l'accueil de l'app. (Le portefeuille est une
  // page client-only → l'accueil du type d'utilisateur = "/".)
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1)
      router.back();
    else router.push("/");
  };
  const { data, isPending } = useQuery({
    queryKey: ["coligo-pay", userId],
    queryFn: fetchColigoPayData,
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 pt-2 pb-24 lg:px-6">
      <button
        type="button"
        onClick={goBack}
        aria-label={t("back")}
        className="text-muted hover:text-foreground hover:bg-surface-2 -ms-1 mb-3 inline-flex size-9 items-center justify-center rounded-full transition-colors"
      >
        <ArrowLeft className="size-5 rtl:-scale-x-100" />
      </button>

      {/* HERO premium : carte arrondie (solde + identité). */}
      <section className="from-primary-400 via-primary-600 to-primary-800 relative overflow-hidden rounded-[26px] bg-gradient-to-br px-6 py-6 text-white shadow-[0_22px_50px_-24px_rgba(91,91,230,.6)]">
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

        <p className="mt-5 text-[11px] font-bold tracking-wide uppercase opacity-70">
          {t("coligoPayBalance")}
        </p>
        <p className="mt-0.5 text-[42px] leading-none font-black tracking-tight tabular-nums">
          <WalletBalanceValue
            kind="topup"
            userId={userId}
            initial={data?.balance ?? 0}
          />
        </p>

        {data?.payTag?.handle && (
          <MyPayTag handle={data.payTag.handle} name={data.payTag.name} />
        )}
      </section>

      {/* Actions (chevauchent le bas du hero). Désactivées tant que le plafond
          glissant n'est pas chargé (remaining30d=0) → pas de recharge à l'aveugle. */}
      <WalletActions
        remaining30d={data?.remaining30d ?? 0}
        maxPerRecharge={data?.maxPerRecharge ?? 50000}
        p2pEnabled={data?.p2pEnabled ?? false}
      />

      {/* Lien cashback épuré. */}
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

      {/* Historique TOPUP */}
      <section className="mt-6">
        <h2 className="text-foreground mb-2.5 text-[18px] font-black tracking-tight">
          {t("coligoPayHistory")}
        </h2>
        {isPending && !data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-3 h-16 animate-pulse rounded-[16px]"
              />
            ))}
          </div>
        ) : (
          <WalletEntryList
            entries={data?.history ?? []}
            emptyHint={t("rechargeNow")}
          />
        )}
      </section>
    </div>
  );
}
