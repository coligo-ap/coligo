"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { BRAND_GO, SORA } from "@/components/shared/partner-ui";

/**
 * Volet GAINS du hub Argent (Gains · Courses · Coligo Pay via MoneyTabs) —
 * même maquette que les Gains chauffeur : carte « Ce mois » avec 2 tuiles
 * (Aujourd'hui / Net ce mois) + lignes de détail, carte violette « Relevé &
 * versement ». Le solde/recharge vit dans l'onglet Coligo Pay (zéro doublon).
 * Montants 100 % réels (delivery_ledger) ; groupement manuel (anti-#418).
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

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

      {/* Le verdict « où j'en suis avec Coligo » (montant réel + Détail + PDF)
          et le solde Coligo Pay sont rendus PAR LA PAGE (SettlementVerdict +
          WalletGlance partagés) juste sous cette carte — plus de carte
          « Relevé » mystérieuse sans montant. */}
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
