"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { CheckCircle2, ChevronRight, FileDown, Wallet } from "lucide-react";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  BRAND_VIOLET_D,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * VUE D'ENSEMBLE ARGENT partagée livreur/chauffeur — l'onglet Gains raconte
 * l'argent dans l'ordre HUMAIN, sans jargon :
 *  1. ce que j'ai gagné (cartes gains, par l'espace) ;
 *  2. OÙ J'EN SUIS avec Coligo → SettlementVerdict : le montant RÉEL à
 *     reverser / à recevoir (ou « à jour »), avec Détail et PDF ;
 *  3. combien j'ai dans mon portefeuille → WalletGlance : solde Coligo Pay
 *     en un coup d'œil + Recharger (le détail vit dans l'onglet Coligo Pay).
 */

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/* ─────────────── 2. Verdict de règlement (montant réel) ─────────────── */

export function SettlementVerdict({
  direction,
  amountDa,
  dueLabel,
  detailHref,
  pdfHref,
}: {
  direction: "reverse" | "receive" | "settled";
  amountDa: number;
  dueLabel?: string | null;
  /** Sous-page du détail (relevé) — optionnel (chauffeur : pas de relevé). */
  detailHref?: string;
  /** Export PDF — optionnel. */
  pdfHref?: string;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  // À jour : simple ligne verte apaisante (rien à faire).
  if (direction === "settled") {
    return (
      <div
        className="my-3 flex items-center gap-2.5 rounded-[16px] px-4 py-3.5 text-[13px] font-bold"
        style={{ background: "rgba(22,179,100,.1)", color: BRAND_GO }}
      >
        <CheckCircle2 className="size-5 shrink-0" />
        {tr(
          "Vous êtes à jour avec Coligo — rien à régler.",
          "أنت على ما يرام مع كوليغو — لا شيء للتسوية."
        )}
        {detailHref && (
          <Link
            href={detailHref}
            className="ms-auto text-[12px] font-bold underline"
          >
            {tr("Détail", "التفاصيل")}
          </Link>
        )}
      </div>
    );
  }

  const reverse = direction === "reverse";
  return (
    <div
      className="my-3 rounded-[20px] p-4 text-white"
      style={{
        background: reverse
          ? `linear-gradient(135deg, ${BRAND_VIOLET}, ${BRAND_VIOLET_D})`
          : `linear-gradient(135deg, #0e8c4d, ${BRAND_GO})`,
        boxShadow: reverse
          ? "0 14px 30px -12px rgba(108,43,217,.5)"
          : "0 14px 30px -12px rgba(22,179,100,.5)",
      }}
    >
      <p className="text-[12px] font-semibold opacity-90">
        {reverse
          ? tr("À reverser à Coligo", "للتسديد إلى كوليغو")
          : tr("Coligo vous doit", "كوليغو مدينة لك")}
      </p>
      <p
        className="mt-1 text-[28px] leading-none font-extrabold tracking-[-1px]"
        style={{ fontFamily: SORA }}
      >
        {grp(amountDa)} {tr("DA", "دج")}
      </p>
      {dueLabel && <p className="mt-1.5 text-[11px] opacity-90">{dueLabel}</p>}

      {(detailHref || pdfHref) && (
        <div className="mt-3 flex gap-2">
          {detailHref && (
            <Link
              href={detailHref}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-white/16 py-2.5 text-[12.5px] font-bold"
            >
              {tr("Voir le détail", "عرض التفاصيل")}
              <ChevronRight className="size-3.5 rtl:rotate-180" />
            </Link>
          )}
          {pdfHref && (
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-white/16 py-2.5 text-[12.5px] font-bold"
            >
              <FileDown className="size-3.5" />
              {tr("Relevé PDF", "كشف PDF")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── 3. Solde Coligo Pay en un coup d'œil ─────────────── */

export function WalletGlance({ rechargeHref }: { rechargeHref: string }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    void getMyWalletState().then((s) => setBalance(s?.effectiveBalanceDa ?? 0));
  }, []);
  const low = balance != null && balance < 0;

  return (
    <Link
      href={rechargeHref}
      className="flex items-center gap-3 rounded-[16px] border p-3.5"
      style={
        low
          ? {
              borderColor: "rgba(229,72,77,.25)",
              background: "rgba(229,72,77,.05)",
            }
          : { borderColor: "var(--d-line)", background: "var(--d-surface)" }
      }
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[11px]"
        style={{
          background: low ? "rgba(229,72,77,.12)" : "var(--d-accent)",
          color: low ? BRAND_RED : BRAND_VIOLET,
        }}
      >
        <Wallet className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-[var(--d-muted)]">
          {tr("Solde Coligo Pay", "رصيد كوليغو باي")}
        </span>
        <b
          className="block text-[16px] leading-tight tracking-[-0.3px]"
          style={{
            fontFamily: SORA,
            color: low ? BRAND_RED : "var(--d-ink)",
          }}
        >
          {balance == null
            ? "…"
            : `${balance < 0 ? "-" : ""}${grp(balance)} ${tr("DA", "دج")}`}
        </b>
      </span>
      <span
        className="flex shrink-0 items-center gap-1 text-[12.5px] font-bold"
        style={{ color: BRAND_VIOLET }}
      >
        {tr("Recharger", "اشحن")}
        <ChevronRight className="size-4 rtl:rotate-180" />
      </span>
    </Link>
  );
}
