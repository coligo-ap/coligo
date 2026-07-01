"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { History, Plus, Wallet } from "lucide-react";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  BRAND_VIOLET_D,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * Écran GAINS livreur — MÊME maquette que les Gains chauffeur (d-gains) :
 * titre + bouton Historique, carte Solde portefeuille (→ recharge), carte
 * « Ce mois » avec 2 tuiles (Aujourd'hui / Net ce mois) + lignes de détail,
 * carte violette « Relevé & versement ». Les montants restent 100 % réels
 * (delivery_ledger, mêmes sommes par type qu'avant) ; groupement des chiffres
 * manuel (anti-hydratation #418).
 */

export type GainsEntry = {
  id: string;
  type:
    | "driver_payout"
    | "driver_cash_collected"
    | "driver_owes_merchant"
    | "driver_owes_platform"
    | "driver_advance_refund"
    | "adjustment";
  amount_da: number;
  note: string | null;
  created_at: string;
  merchant_id: string | null;
};

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MONTHS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function GainsView({ entries }: { entries: GainsEntry[] }) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  // Solde portefeuille opérateur (même source que le chauffeur).
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    void getMyWalletState().then((s) => setBalance(s?.effectiveBalanceDa ?? 0));
  }, []);
  const lowBalance = balance != null && balance < 0;

  const { today, todayCount, month, monthCount, cashMonth, avg } =
    useMemo(() => {
      const now = new Date();
      const dayFrom = startOfDay(now);
      const monthFrom = startOfMonth(now);
      const payouts = entries.filter((e) => e.type === "driver_payout");
      const inRange = (rows: GainsEntry[], from: Date) =>
        rows.filter((e) => new Date(e.created_at) >= from);
      const sum = (rows: GainsEntry[]) =>
        rows.reduce((s, e) => s + e.amount_da, 0);
      const dayRows = inRange(payouts, dayFrom);
      const monthRows = inRange(payouts, monthFrom);
      const cashRows = inRange(
        entries.filter((e) => e.type === "driver_cash_collected"),
        monthFrom
      );
      const monthTotal = sum(monthRows);
      return {
        today: sum(dayRows),
        todayCount: dayRows.length,
        month: monthTotal,
        monthCount: monthRows.length,
        cashMonth: sum(cashRows),
        avg: monthRows.length ? Math.round(monthTotal / monthRows.length) : 0,
      };
    }, [entries]);

  const monthName = (isAr ? MONTHS_AR : MONTHS_FR)[new Date().getMonth()];

  return (
    <>
      {/* Titre + Historique (parité d-gains) */}
      <div className="mb-3 flex items-center gap-3">
        <h1
          className="flex-1 text-[21px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {tr("Gains", "الأرباح")}
        </h1>
        <button
          type="button"
          onClick={() => router.push("/driver/historique")}
          className="flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2 text-xs font-bold text-[var(--d-ink)] shadow"
        >
          <History className="size-3.5" /> {tr("Historique", "السجل")}
        </button>
      </div>

      {/* Solde portefeuille + recharge (tap = page de recharge). */}
      <button
        type="button"
        onClick={() => router.push("/driver/recharger")}
        className="mb-3 flex w-full items-center gap-3 rounded-[16px] border p-3.5 text-left"
        style={
          lowBalance
            ? {
                borderColor: "rgba(229,72,77,.25)",
                background: "rgba(229,72,77,.05)",
              }
            : { borderColor: "var(--d-line)", background: "var(--d-surface)" }
        }
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[12px]"
          style={{
            background: lowBalance ? "rgba(229,72,77,.12)" : "var(--d-accent)",
            color: lowBalance ? BRAND_RED : BRAND_VIOLET,
          }}
        >
          <Wallet className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-[var(--d-muted)]">
            {tr("Solde portefeuille", "رصيد المحفظة")}
          </span>
          <b
            className="block text-[19px] leading-none tracking-[-0.5px]"
            style={{
              fontFamily: SORA,
              color: lowBalance ? BRAND_RED : "var(--d-ink)",
            }}
          >
            {balance == null ? "…" : `${grp(balance)} ${tr("DA", "دج")}`}
          </b>
        </span>
        <span
          className="flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-bold text-white"
          style={{ fontFamily: SORA, background: BRAND_VIOLET }}
        >
          <Plus className="size-4" /> {tr("Recharger", "اشحن")}
        </span>
      </button>

      {/* BILAN COMBINÉ (parité d-gains) : aujourd'hui + ce mois. */}
      <div className="rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <b
            className="text-sm text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {tr(`Ce mois (${monthName})`, `هذا الشهر (${monthName})`)}
          </b>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[14px] bg-[var(--d-soft)] px-3 py-2.5">
            <span className="block text-[10.5px] text-[var(--d-muted)]">
              {tr("Aujourd'hui", "اليوم")}
            </span>
            <b
              className="text-[18px]"
              style={{ fontFamily: SORA, color: BRAND_GO }}
            >
              {grp(today)} {tr("DA", "دج")}
            </b>
            <span className="mt-0.5 block text-[10px] text-[var(--d-muted)]">
              {todayCount} {isAr ? "توصيلة" : "courses"}
            </span>
          </div>
          <div className="rounded-[14px] bg-[var(--d-soft)] px-3 py-2.5">
            <span className="block text-[10.5px] text-[var(--d-muted)]">
              {tr("Net ce mois", "صافي هذا الشهر")}
            </span>
            <b
              className="text-[18px]"
              style={{ fontFamily: SORA, color: BRAND_GO }}
            >
              {grp(month)} {tr("DA", "دج")}
            </b>
            <span className="mt-0.5 block text-[10px] text-[var(--d-muted)]">
              {monthCount} {isAr ? "توصيلة" : "courses"}
            </span>
          </div>
        </div>

        <div className="mt-1.5">
          <Line
            k={tr("Cash encaissé (ce mois)", "النقد المحصّل (هذا الشهر)")}
            v={`${grp(cashMonth)} ${tr("DA", "دج")}`}
          />
          <Line
            k={tr("Gain moyen / course", "متوسط الربح / توصيلة")}
            v={`${grp(avg)} ${tr("DA", "دج")}`}
          />
        </div>
      </div>

      {/* Relevé & versement — carte violette (parité « À reverser » d-gains). */}
      <Link
        href="/driver/releve"
        className="my-3 block rounded-[18px] p-4 text-white"
        style={{
          background: `linear-gradient(135deg, ${BRAND_VIOLET}, ${BRAND_VIOLET_D})`,
          boxShadow: "0 14px 30px -12px rgba(108,43,217,.5)",
        }}
      >
        <p className="text-xs opacity-85">
          {tr("Relevé & versement", "كشف الحساب والتسديد")}
        </p>
        <p
          className="mt-1 text-[20px] font-extrabold"
          style={{ fontFamily: SORA }}
        >
          {tr("Voir mon solde à régler", "عرض رصيدي للتسوية")} →
        </p>
        <p className="mt-1 text-[11px] opacity-90">
          {tr(
            "Solde à reverser / à recevoir · CCP · BaridiMob",
            "الرصيد المستحق له/عليه · CCP · BaridiMob"
          )}
        </p>
      </Link>
    </>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--d-line)] py-2.5 text-[13px] last:border-b-0">
      <span className="text-[var(--d-muted)]">{k}</span>
      <b className="text-[var(--d-ink)]" style={{ fontFamily: SORA }}>
        {v}
      </b>
    </div>
  );
}
