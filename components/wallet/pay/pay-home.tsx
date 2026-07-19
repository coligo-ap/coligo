"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Clock3,
  Eye,
  EyeOff,
  Gift,
  Info,
  Percent,
  Plus,
  Settings2,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  BRAND_VIOLET_D,
  SORA,
} from "@/components/shared/partner-ui";
import {
  OWNER_BADGE,
  OWNER_CTX,
} from "@/components/wallet/operator-recharge-strings";
import {
  PayAmount,
  PayCard,
  PayLoadError,
  PayScreen,
  PaySkeleton,
  groupNum,
  kindOf,
  ownerOf,
  payHref,
  usePayLang,
  useHideBalance,
  usePayWallet,
  withdrawHref,
  type OpsKind,
  type PayBase,
} from "./pay-core";

/**
 * COLIGO PAY — HOME. Un seul objectif : « où en est mon argent, et quelles
 * sont mes 3 actions » (Recharger / Retirer / Historique). Tout le reste vit
 * dans des pages dédiées (choix de méthode, flux par méthode, historique
 * complet, détail-reçu, paramètres).
 */
export function PayHome({ base }: { base: PayBase }) {
  const router = useRouter();
  const search = useSearchParams();
  const { lang, t, dir } = usePayLang();
  const { state, entries, loading, failed, refresh } = usePayWallet({
    entriesLimit: 60,
  });
  const { hidden, toggle } = useHideBalance();

  // Rétro-compatibilité des anciens liens : `?method=` (feuille d'abonnement
  // historique) et `?topup=` (retour Chargily vers l'ancien écran unique)
  // redirigent vers la PAGE dédiée du nouveau parcours.
  useEffect(() => {
    const method = search.get("method");
    const topup = search.get("topup");
    if (topup) {
      router.replace(payHref(base, `/carte?topup=${topup}`));
      return;
    }
    if (method === "ccp") router.replace(payHref(base, "/ccp"));
    else if (method === "cash") router.replace(payHref(base, "/especes"));
    else if (method === "card") router.replace(payHref(base, "/carte"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owner = ownerOf(state);

  // « Aperçu ce mois » : affiché UNIQUEMENT si les écritures chargées couvrent
  // tout le mois en cours (sinon les sommes seraient fausses — on préfère rien).
  const month = useMemo(() => {
    if (!entries.length) return null;
    const monthKey = new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Algiers",
    });
    const monthStart = `${monthKey.slice(0, 7)}-01`;
    const oldest = entries[entries.length - 1];
    const coversMonth =
      entries.length < 60 || String(oldest.createdAt).slice(0, 10) < monthStart;
    if (!coversMonth) return null;
    const inMonth = entries.filter(
      (e) => String(e.createdAt).slice(0, 10) >= monthStart
    );
    if (!inMonth.length) return null;
    const byKind = new Map<OpsKind, number>();
    let net = 0;
    for (const e of inMonth) {
      net += e.amountDa;
      const k = kindOf(e);
      byKind.set(k, (byKind.get(k) ?? 0) + e.amountDa);
    }
    const ICONS: Partial<Record<OpsKind, LucideIcon>> = {
      vente: ShoppingBag,
      recharge: Plus,
      commission: Percent,
      cashback: Gift,
    };
    const order: OpsKind[] =
      owner === "merchant"
        ? ["vente", "commission", "cashback"]
        : ["recharge", "commission", "cashback"];
    const rows = order
      .filter((k) => (byKind.get(k) ?? 0) !== 0)
      .map((k) => ({ kind: k, sum: byKind.get(k) ?? 0, Icon: ICONS[k] }));
    return rows.length ? { rows, net } : null;
  }, [entries, owner]);

  if (loading && !state) {
    return (
      <PayScreen dir={dir}>
        <PaySkeleton />
      </PayScreen>
    );
  }
  if (!state) {
    return (
      <PayScreen dir={dir}>
        {failed ? (
          <PayLoadError onRetry={() => void refresh()} />
        ) : (
          <PaySkeleton />
        )}
      </PayScreen>
    );
  }

  return (
    <PayScreen dir={dir}>
      {/* HERO portefeuille */}
      <div
        className="rounded-[22px] p-5 text-white"
        style={{
          background: `linear-gradient(135deg, ${BRAND_VIOLET}, ${BRAND_VIOLET_D})`,
          boxShadow: "0 18px 40px -14px rgba(108,43,217,.45)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-[12px] bg-white/15">
            <Wallet className="size-[18px]" />
          </span>
          <span className="flex-1 text-[12.5px] font-semibold opacity-90">
            {t.myWallet}
          </span>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-bold">
            {OWNER_BADGE[lang][owner]}
          </span>
          {/* Paramètres financiers — action contextuelle du portefeuille
              (pas un raccourci de plus en bas de page). */}
          <Link
            href={payHref(base, "/parametres")}
            prefetch
            aria-label={t.settings}
            className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/15"
          >
            <Settings2 className="size-4" />
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span
            className="text-[34px] leading-none font-extrabold tracking-[-1px]"
            style={{ fontFamily: SORA }}
          >
            {hidden ? (
              "•••••"
            ) : (
              <>
                {groupNum(state.effectiveBalanceDa)}{" "}
                <small className="text-[15px] font-bold opacity-85">DA</small>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-label={t.hideBalance}
            className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/15"
          >
            {hidden ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </button>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-bold">
            <i
              className="size-1.5 rounded-full"
              style={{ background: state.canOperate ? "#6ef0ae" : "#ffb3b6" }}
            />
            {state.canOperate ? t.active : t.blocked}
          </span>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug opacity-85">
          <Info className="mt-[1px] size-3.5 shrink-0" />
          {OWNER_CTX[lang][owner]}
        </p>
      </div>

      {/* ACTIONS — 3 portes d'entrée, chacune vers SA page */}
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {(
          [
            { href: payHref(base, "/methode"), Icon: Plus, label: t.recharge },
            { href: withdrawHref(base), Icon: ArrowUpRight, label: t.withdraw },
            {
              href: payHref(base, "/historique"),
              Icon: Clock3,
              label: t.history,
            },
          ] as const
        ).map((a) => (
          <Link
            key={a.href}
            href={a.href}
            prefetch
            className="flex flex-col items-center gap-1.5 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-3"
          >
            <span
              className="grid size-10 place-items-center rounded-full"
              style={{
                background: "var(--d-accent)",
                color: "var(--d-violet)",
              }}
            >
              <a.Icon className="size-[18px]" />
            </span>
            <span className="text-[11.5px] font-bold text-[var(--d-ink)]">
              {a.label}
            </span>
          </Link>
        ))}
      </div>

      {/* APERÇU CE MOIS — seulement si les données couvrent le mois entier */}
      {month && (
        <PayCard className="mt-3">
          {/* Un seul chemin vers l'historique : l'action « Historique »
              ci-dessus (pas de « Voir tout » doublon). */}
          <div className="px-3.5 pt-3 pb-1">
            <p className="text-[12px] font-bold text-[var(--d-muted)]">
              {t.monthOverview}
            </p>
          </div>
          {month.rows.map((r) => (
            <div
              key={r.kind}
              className="flex items-center gap-2.5 border-b border-[var(--d-line)] px-3.5 py-2.5 last:border-b-0"
            >
              {r.Icon && (
                <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[var(--d-soft)] text-[var(--d-muted)]">
                  <r.Icon className="size-3.5" />
                </span>
              )}
              <span className="flex-1 text-[12.5px] font-semibold text-[var(--d-ink)]">
                {kindLabelShort(r.kind, lang)}
              </span>
              <PayAmount amountDa={r.sum} size={12.5} />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-[var(--d-line)] px-3.5 py-2.5">
            <span className="text-[12.5px] font-extrabold text-[var(--d-ink)]">
              Net
            </span>
            <span
              className="text-[13.5px] font-extrabold"
              style={{
                color: month.net >= 0 ? BRAND_GO : BRAND_RED,
                fontFamily: SORA,
              }}
            >
              {month.net >= 0 ? "+" : "−"}
              {groupNum(month.net)} DA
            </span>
          </div>
        </PayCard>
      )}

      {/* RÈGLE zéro doublon : la LISTE des opérations vit UNIQUEMENT sur la
          page Historique (action ci-dessus) — l'accueil s'arrête au résumé.
          Aucun raccourci de plus : chaque page reste sur son thème. */}
    </PayScreen>
  );
}

function kindLabelShort(kind: OpsKind, lang: "fr" | "ar"): string {
  const L: Record<OpsKind, [string, string]> = {
    vente: ["Ventes", "المبيعات"],
    recharge: ["Recharges", "الشحن"],
    commission: ["Commissions", "العمولات"],
    cashback: ["Cashback", "كاش باك"],
    autre: ["Autres", "أخرى"],
  };
  return L[kind][lang === "ar" ? 1 : 0];
}
