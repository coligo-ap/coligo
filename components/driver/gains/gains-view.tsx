"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  PartnerSegmented,
  PartnerStatTiles,
} from "@/components/shared/partner-ui";

/**
 * Écran GAINS reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages (section Gains) :
 * .head + .miniseg (Jour/Semaine/Mois) + grande .card (total + delta + graphe
 * 7 jours) + .tiles + .linkcard « Relevé & versement ».
 *
 * Montants 100 % réels (delivery_ledger, mêmes sommes par type qu'avant). Le
 * groupement des chiffres est manuel (espace) → déterministe SSR↔client
 * (anti-hydratation #418).
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

type Period = "day" | "week" | "month";

const PERIODS: { key: Period; label: string; labelAr: string }[] = [
  { key: "day", label: "Jour", labelAr: "يوم" },
  { key: "week", label: "Semaine", labelAr: "أسبوع" },
  { key: "month", label: "Mois", labelAr: "شهر" },
];
const PERIOD_TITLE: Record<Period, [string, string]> = {
  day: ["Aujourd'hui", "اليوم"],
  week: ["Cette semaine", "هذا الأسبوع"],
  month: ["Ce mois-ci", "هذا الشهر"],
};
const PERIOD_PREV: Record<Period, [string, string]> = {
  day: ["hier", "أمس"],
  week: ["semaine dernière", "الأسبوع الماضي"],
  month: ["mois dernier", "الشهر الماضي"],
};
const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date) {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7;
  s.setDate(s.getDate() - dow);
  return s;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function GainsView({ entries }: { entries: GainsEntry[] }) {
  const isAr = useLocale() === "ar";
  const L = isAr ? 1 : 0;
  const [period, setPeriod] = useState<Period>("day");

  const { total, count, avg, cashCollected, deltaPct, bars } = useMemo(() => {
    const now = new Date();
    const curFrom =
      period === "day"
        ? startOfDay(now)
        : period === "week"
          ? startOfWeek(now)
          : startOfMonth(now);
    // Borne basse de la période précédente (même durée).
    const prevFrom =
      period === "day"
        ? new Date(curFrom.getTime() - 86_400_000)
        : period === "week"
          ? new Date(curFrom.getTime() - 7 * 86_400_000)
          : new Date(curFrom.getFullYear(), curFrom.getMonth() - 1, 1);

    const payoutsBetween = (from: Date, to: Date) =>
      entries.filter(
        (e) =>
          e.type === "driver_payout" &&
          new Date(e.created_at) >= from &&
          new Date(e.created_at) < to
      );
    const sum = (rows: GainsEntry[]) =>
      rows.reduce((s, e) => s + e.amount_da, 0);

    const cur = payoutsBetween(curFrom, now);
    const prev = payoutsBetween(prevFrom, curFrom);
    const curTotal = sum(cur);
    const prevTotal = sum(prev);

    const cashRows = entries.filter(
      (e) =>
        e.type === "driver_cash_collected" && new Date(e.created_at) >= curFrom
    );

    // Graphe : semaine courante (lundi → dimanche), payout/jour.
    const weekStart = startOfWeek(now);
    const todayIdx = (now.getDay() + 6) % 7;
    const dayTotals = Array.from({ length: 7 }, (_, i) => {
      const ds = new Date(weekStart);
      ds.setDate(weekStart.getDate() + i);
      const de = new Date(ds);
      de.setDate(ds.getDate() + 1);
      return sum(payoutsBetween(ds, de));
    });
    const max = Math.max(1, ...dayTotals);

    return {
      total: curTotal,
      count: cur.length,
      avg: cur.length > 0 ? Math.round(curTotal / cur.length) : 0,
      cashCollected: sum(cashRows),
      deltaPct:
        prevTotal > 0
          ? Math.round(((curTotal - prevTotal) / prevTotal) * 100)
          : null,
      bars: dayTotals.map((v, i) => ({
        pct: Math.max(4, Math.round((v / max) * 100)),
        now: i === todayIdx,
        letter: DAY_LETTERS[i],
      })),
    };
  }, [entries, period]);

  return (
    <>
      <div className="head">
        <h1>{isAr ? "الأرباح" : "Gains"}</h1>
        <div className="ic">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </div>
      </div>

      <div className="mb-4">
        <PartnerSegmented
          options={PERIODS.map((p) => ({
            key: p.key,
            label: isAr ? p.labelAr : p.label,
          }))}
          value={period}
          onChange={setPeriod}
        />
      </div>

      <div className="card">
        <div
          style={{ fontSize: "12.5px", fontWeight: 600 }}
          className="text-[var(--muted)]"
        >
          {PERIOD_TITLE[period][L]} · {count}{" "}
          {isAr ? "توصيلة" : "course" + (count > 1 ? "s" : "")}
        </div>
        <div className="big-amt" style={{ marginTop: 8 }}>
          {grp(total)} <small>DA</small>
        </div>
        {deltaPct !== null && (
          <span className="delta">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 17L17 7M17 7H8M17 7v9" />
            </svg>
            {deltaPct >= 0 ? "+" : ""}
            {deltaPct}% {isAr ? "مقابل" : "vs"} {PERIOD_PREV[period][L]}
          </span>
        )}
        <div className="chart">
          {bars.map((b, i) => (
            <div key={i} className={"bar" + (b.now ? " on" : "")}>
              <i style={{ height: `${b.pct}%` }} />
              <span>{b.letter}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3.5">
        <PartnerStatTiles
          tiles={[
            {
              value: `${grp(avg)} DA`,
              label: isAr ? "متوسط الربح / توصيلة" : "Gain moyen / course",
            },
            {
              value: `${grp(cashCollected)} DA`,
              label: isAr ? "النقد المحصّل" : "Cash encaissé",
            },
          ]}
        />
      </div>

      <Link href="/driver/releve" className="linkcard">
        <div className="ic">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        </div>
        <div className="t">
          <b>{isAr ? "كشف الحساب والتسديد" : "Relevé & versement"}</b>
          <span>
            {isAr
              ? "الرصيد المستحق له/عليه · CCP · BaridiMob"
              : "Solde à reverser / à recevoir · CCP · BaridiMob"}
          </span>
        </div>
        <svg
          className="chev"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </>
  );
}
