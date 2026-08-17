"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowLeft, Coins, CreditCard, Gift, Wallet } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import {
  fetchCashbackHistory,
  fetchLoyaltyOverview,
} from "@/app/(customer)/cashback/actions";
import type { CustomerWalletEntry } from "@/lib/customer/cashback";
import { WalletEntryList } from "@/components/customer/wallet/entry-list";
import { SeeMoreButton } from "@/components/customer/wallet/see-more-button";
import { useSeeMore } from "@/lib/hooks/use-see-more";
import { WalletBalanceValue } from "@/components/customer/wallet/balance-value";
import { ThemeDecor } from "@/components/shared/theme-decor";
import { LoyaltySection } from "@/components/customer/loyalty/loyalty-section";

type Tab = "cashback" | "fidelite";

/** Taille de page des historiques (= serveur, cf. actions PAGINATION). */
const HISTORY_PAGE = 20;

/**
 * Contenu de /cashback via TanStack Query (pattern OrdersLoader). Le RSC ne fait
 * que les gardes (auth + flag) ; ici le solde vient du cache PARTAGÉ
 * `wallet-balances` (même clé que /compte et /coligo-pay → affichage instantané)
 * et l'historique d'un cache persistant → plus de rechargement complet à chaque
 * navigation, juste une revalidation silencieuse.
 *
 * DEUX POCHES DISTINCTES (exigence propriétaire) : le CASHBACK (gagné en
 * commandant sur l'app — livraison ou retrait, utilisable partout) et la
 * FIDÉLITÉ EN MAGASIN (cagnotte par commerçant, dépensable uniquement chez
 * lui) sont des systèmes séparés → nav segmentée, panneaux MONTÉS (l'inactif
 * en `hidden`, jamais `key={tab}` qui perdrait l'état) + fondu à l'activation.
 */
export function CashbackLoader({
  userId,
  loyaltyVisible = false,
}: {
  userId: string;
  /** Onglet « Fidélité en magasin » (drapeau `loyalty` — dormant avant
   *  lancement, zéro changement visuel tant qu'il est masqué). */
  loyaltyVisible?: boolean;
}) {
  const t = useTranslations("wallet");
  const tAccount = useTranslations("account");
  const params = useSearchParams();

  // FIDÉLITÉ = onglet PAR DÉFAUT (demande propriétaire). ?tab=cashback (liens
  // directs, ex. depuis Coligo Pay) force l'onglet cashback.
  const [tab, setTab] = useState<Tab>(() =>
    !loyaltyVisible || params.get("tab") === "cashback"
      ? "cashback"
      : "fidelite"
  );

  const { data: history, isPending } = useQuery({
    queryKey: ["cashback-history", userId],
    queryFn: () => fetchCashbackHistory(0),
    staleTime: 30_000,
  });
  // « Voir plus » : pages suivantes (20 par page, jamais tout d'un coup).
  const more = useSeeMore<CustomerWalletEntry>(
    fetchCashbackHistory,
    HISTORY_PAGE
  );
  const entries = [...(history ?? []), ...more.extra];

  // Badge de l'onglet Fidélité = bons actifs (même clé de cache que la section
  // → une seule requête réseau, deux lecteurs).
  const { data: overview } = useQuery({
    queryKey: ["loyalty-overview", userId],
    queryFn: fetchLoyaltyOverview,
    staleTime: 30_000,
    enabled: loyaltyVisible,
  });
  const voucherCount =
    overview?.accounts.reduce((s, a) => s + a.summary.vouchers.length, 0) ?? 0;

  // Bascule = état purement client ; l'URL suit via replaceState (zéro RSC).
  // Fidélité étant l'onglet par défaut, seul ?tab=cashback est posé dans l'URL.
  function switchTab(next: Tab) {
    setTab(next);
    try {
      const u = new URL(window.location.href);
      if (next === "cashback") u.searchParams.set("tab", "cashback");
      else u.searchParams.delete("tab");
      window.history.replaceState(null, "", u);
    } catch {
      /* sans gravité */
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 lg:px-6">
      {/* Fondu doux à chaque (ré)activation d'un panneau (classe ré-appliquée). */}
      <style>{`@keyframes cfFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.cf-panel{animation:cfFade .18s ease}`}</style>

      <Link
        href="/compte"
        className="text-muted hover:text-foreground mt-1 mb-2 inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {tAccount("myAccount")}
      </Link>

      {loyaltyVisible && (
        <Segmented<Tab>
          ariaLabel={t("cashbackTitle")}
          className="mb-3"
          value={tab}
          onChange={switchTab}
          options={[
            // Fidélité EN PREMIER : c'est l'onglet par défaut de la page.
            {
              key: "fidelite",
              label: (
                <>
                  <CreditCard className="size-4" />
                  {t("loyTab")}
                </>
              ),
              badge: voucherCount,
            },
            {
              key: "cashback",
              label: (
                <>
                  <Coins className="size-4" />
                  {t("cashTab")}
                </>
              ),
            },
          ]}
        />
      )}

      {/* ─────────────────────────── Onglet CASHBACK ─────────────────────────── */}
      <div
        className={
          !loyaltyVisible || tab === "cashback" ? "cf-panel" : "hidden"
        }
      >
        {/* HERO premium — MÊME langage que la marketplace/Coligo Pay : dégradé
            du thème « occasion » (vars sur <html>, mig 0415/0416) + décor du
            modèle choisi par le super-admin + grain. */}
        <section
          className="rounded-panel-lg relative overflow-hidden px-5 pt-7 pb-7 text-white"
          style={{
            backgroundImage:
              "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
          }}
        >
          <ThemeDecor />
          <Gift className="absolute -end-7 -top-5 size-32 text-white/[.13]" />
          <div className="relative z-10">
            <p className="text-xs font-extrabold tracking-wider uppercase opacity-85">
              {t("cashbackTitle")} · {t("availableBalance")}
            </p>
            <p className="mt-1 text-[32px] leading-none font-black tracking-tight tabular-nums lg:text-5xl">
              <WalletBalanceValue kind="cashback" userId={userId} initial={0} />
            </p>
            <p className="text-label-lg mt-2.5 max-w-md leading-relaxed font-semibold opacity-90">
              {t("cashHeroEarn")}
            </p>
            <p className="text-label-lg mt-1 max-w-md leading-relaxed font-semibold opacity-90">
              {t.rich("cashbackNonWithdrawable", {
                strong: (chunks) => (
                  <strong className="font-extrabold">{chunks}</strong>
                ),
              })}
            </p>
          </div>
        </section>

        {/* Card info : Coligo Pay (différent du cashback) → page dédiée. */}
        <Link
          href="/coligo-pay"
          className="rounded-sheet-lg mt-4 flex items-center gap-3 bg-white p-4 transition-transform active:scale-[.99]"
        >
          <div className="bg-primary-50 text-primary-600 rounded-card flex size-[46px] shrink-0 items-center justify-center">
            <Wallet className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-body-xl font-extrabold tracking-tight">
              {t("coligoPayLinkTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("coligoPayLinkDesc")}
            </p>
          </div>
        </Link>

        {/* Historique CASHBACK uniquement (timeline) */}
        <section className="mt-6">
          <h2 className="text-foreground text-heading-sm mb-2.5 font-black tracking-tight">
            {t("cashbackHistory")}
          </h2>
          {isPending && !history ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-3 h-16 animate-pulse rounded-lg"
                />
              ))}
            </div>
          ) : (
            <>
              <WalletEntryList
                entries={entries}
                emptyHint={t("discoverMerchants")}
              />
              {(history ?? []).length >= HISTORY_PAGE && !more.end && (
                <SeeMoreButton
                  onClick={() => void more.loadMore()}
                  loading={more.loading}
                  label={t("seeMore")}
                />
              )}
            </>
          )}
        </section>
      </div>

      {/* ─────────────────────────── Onglet FIDÉLITÉ ─────────────────────────── */}
      {loyaltyVisible && (
        <div className={tab === "fidelite" ? "cf-panel" : "hidden"}>
          <LoyaltySection userId={userId} />
        </div>
      )}
    </div>
  );
}
