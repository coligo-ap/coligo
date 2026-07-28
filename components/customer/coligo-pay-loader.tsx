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
import { ThemeDecor } from "@/components/shared/theme-decor";

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
    <div className="pb-24">
      {/* HÉRO INTÉGRÉ AU HAUT DE PAGE (style accueil Drive) : pleine largeur
          depuis la barre de statut — zéro blanc perdu, moins de scroll. Même
          langage que la marketplace : dégradé du thème « occasion » (vars sur
          <html>, mig 0415/0416) + décor du modèle + grain. */}
      <section
        className="relative overflow-hidden rounded-b-[28px] px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-14 text-white lg:px-6"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <div className="relative z-10 mx-auto max-w-2xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              aria-label={t("back")}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-white"
            >
              <ArrowLeft className="size-5 rtl:-scale-x-100" />
            </button>
            <span className="grid size-7 place-items-center rounded-lg bg-white/20 backdrop-blur">
              <Wallet className="size-4" />
            </span>
            <span className="text-[12.5px] font-extrabold tracking-wide uppercase opacity-90">
              {t("coligoPayTitle")}
            </span>
          </div>

          <p className="mt-4 text-[11px] font-bold tracking-wide uppercase opacity-70">
            {t("coligoPayBalance")}
          </p>
          <p className="mt-0.5 text-[42px] leading-none font-black tracking-tight tabular-nums drop-shadow-sm">
            <WalletBalanceValue
              kind="topup"
              userId={userId}
              initial={data?.balance ?? 0}
            />
          </p>

          {data?.payTag?.handle && (
            <MyPayTag handle={data.payTag.handle} name={data.payTag.name} />
          )}
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-10 max-w-2xl px-4 lg:px-6">
        {/* Actions (chevauchent le bas du hero). Désactivées tant que le plafond
          glissant n'est pas chargé (remaining30d=0) → pas de recharge à l'aveugle. */}
        <WalletActions
          remaining30d={data?.remaining30d ?? 0}
          maxPerRecharge={data?.maxPerRecharge ?? 50000}
          p2pEnabled={data?.p2pEnabled ?? false}
        />

        {/* Lien cashback — carte bordée (affordance claire, cohérente avec le
          reste de la page). */}
        <Link
          href="/cashback"
          className="border-border hover:bg-surface-2 mt-4 flex items-center gap-3 rounded-[16px] border bg-white p-3 transition-colors"
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
    </div>
  );
}
