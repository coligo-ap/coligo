"use client";

import { useMemo, useState } from "react";
import { formatDA } from "@/lib/utils";

/**
 * Écran 5 — MES GAINS (style Uber). Vue cliente : toggle de période
 * (Jour / Semaine / Mois), grand total en violet, graphique en barres par jour
 * de la semaine courante, tuiles Cash encaissé / Dû commerçant, historique.
 *
 * ⚠️ Refonte PUREMENT VISUELLE : les montants viennent du même `delivery_ledger`
 * que la version précédente et les sommes par type sont calculées à l'identique
 * (driver_payout, driver_cash_collected, driver_owes_*). On ne fait que filtrer
 * par période côté client et réorganiser l'affichage.
 */

type Entry = {
  id: string;
  type:
    | "driver_payout"
    | "driver_cash_collected"
    | "driver_owes_merchant"
    | "driver_owes_platform"
    | "adjustment";
  amount_da: number;
  note: string | null;
  created_at: string;
  merchant_id: string | null;
};

type Period = "day" | "week" | "month";

const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];
const PERIOD_LABEL: Record<Period, string> = {
  day: "AUJOURD'HUI",
  week: "CETTE SEMAINE",
  month: "CE MOIS-CI",
};
const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Lundi 00:00 de la semaine contenant `d` (semaine ISO, lundi → dimanche). */
function startOfWeek(d: Date) {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // 0 = lundi
  s.setDate(s.getDate() - dow);
  return s;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function GainsView({ entries }: { entries: Entry[] }) {
  const [period, setPeriod] = useState<Period>("week");

  const { total, cashCollected, owesMerchant, bars } = useMemo(() => {
    const now = new Date();
    const from =
      period === "day"
        ? startOfDay(now)
        : period === "week"
          ? startOfWeek(now)
          : startOfMonth(now);

    const inPeriod = entries.filter((e) => new Date(e.created_at) >= from);
    const sum = (rows: Entry[], t: Entry["type"]) =>
      rows.filter((e) => e.type === t).reduce((s, e) => s + e.amount_da, 0);

    // Graphique : toujours la semaine courante (lundi → dimanche), payout/jour.
    const weekStart = startOfWeek(now);
    const todayIdx = (now.getDay() + 6) % 7;
    const dayTotals = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(weekStart);
      dayStart.setDate(weekStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      return entries
        .filter(
          (e) =>
            e.type === "driver_payout" &&
            new Date(e.created_at) >= dayStart &&
            new Date(e.created_at) < dayEnd
        )
        .reduce((s, e) => s + e.amount_da, 0);
    });
    const max = Math.max(1, ...dayTotals);

    return {
      total: sum(inPeriod, "driver_payout"),
      cashCollected: sum(inPeriod, "driver_cash_collected"),
      owesMerchant: sum(inPeriod, "driver_owes_merchant"),
      bars: dayTotals.map((v, i) => ({
        pct: Math.round((v / max) * 100),
        now: i === todayIdx,
        letter: DAY_LETTERS[i],
      })),
    };
  }, [entries, period]);

  const recent = entries.slice(0, 50);

  return (
    <div className="space-y-3 pb-4">
      <h1 className="text-[22px] font-extrabold tracking-tight text-[#0a0a0a]">
        Mes gains
      </h1>

      {/* Grande card : total période + toggle. */}
      <div className="rounded-[16px] bg-white p-[22px] shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <small className="text-[11px] font-bold tracking-[1px] text-[#757575] uppercase">
          Total gagné · {PERIOD_LABEL[period]}
        </small>
        <div className="mt-1.5 text-[42px] leading-none font-black tracking-[-1px] text-[#5c5ce0]">
          {/* Groupement manuel (espace) — déterministe SSR↔client (Intl peut
              différer entre Node et navigateur → hydratation React #418). */}
          {String(Math.round(total)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}
          <span className="ml-1.5 text-[18px] font-bold text-[#666]">DA</span>
        </div>
        <div className="mt-4 inline-flex rounded-full bg-[#f2f2f2] p-[3px]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors " +
                (period === p.key ? "bg-black text-white" : "text-[#757575]")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Graphique en barres (semaine courante). */}
      <div className="rounded-[16px] bg-white p-[16px_18px] shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <h3 className="mb-3.5 flex items-center justify-between text-sm font-bold text-[#0a0a0a]">
          Par jour{" "}
          <small className="text-[11px] font-medium text-[#757575]">DA</small>
        </h3>
        <div className="flex h-[90px] items-end justify-between gap-[7px]">
          {bars.map((b, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-full w-full items-end">
                <div
                  className={
                    "w-full rounded-t-[5px] " +
                    (b.now ? "bg-[#5c5ce0]" : "bg-[#e8e8e8]")
                  }
                  style={{ height: `${Math.max(4, b.pct)}%` }}
                />
              </div>
              <small className="text-[10px] font-bold text-[#757575]">
                {b.letter}
              </small>
            </div>
          ))}
        </div>
      </div>

      {/* Tuiles. */}
      <div className="grid grid-cols-2 gap-[9px]">
        <Tile icon="💵" label="Cash encaissé" value={cashCollected} />
        <Tile icon="🏪" label="Dû commerçant" value={owesMerchant} />
      </div>

      {/* Historique. */}
      <h2 className="px-1 pt-2 pb-1 text-[15px] font-extrabold text-[#0a0a0a]">
        Historique récent
      </h2>
      {recent.length === 0 ? (
        <p className="px-1 text-sm text-[#757575]">
          Aucun mouvement pour l&apos;instant.
        </p>
      ) : (
        <div className="space-y-2">
          {recent.map((e) => {
            const v = view(e);
            return (
              <div
                key={e.id}
                className="flex items-center gap-[11px] rounded-[13px] bg-white px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,.04)]"
              >
                <div
                  className={
                    "grid size-9 shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-[13px] font-extrabold " +
                    (v.dir === "up" ? "text-[#00a86b]" : "text-[#e53935]")
                  }
                >
                  {v.dir === "up" ? "↑" : "↓"}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-bold text-[#0a0a0a]">
                    {typeLabel(e.type)}
                  </b>
                  <small className="text-[11px] font-medium text-[#757575]">
                    {new Date(e.created_at).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      // timeZone fixe → pas de mismatch d'hydratation (#418).
                      timeZone: "Africa/Algiers",
                    })}
                  </small>
                </div>
                <div
                  className={
                    "text-sm font-extrabold tabular-nums " +
                    (v.dir === "up" ? "text-[#00a86b]" : "text-[#e53935]")
                  }
                >
                  {v.sign}
                  {formatDA(Math.abs(e.amount_da))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[13px] bg-white p-3.5 shadow-[0_4px_12px_rgba(0,0,0,.04)]">
      <div className="mb-2.5 grid size-8 place-items-center rounded-full bg-[#f5f5f5] text-sm">
        {icon}
      </div>
      <small className="block text-[11px] font-semibold text-[#757575]">
        {label}
      </small>
      <b className="mt-0.5 block text-[18px] font-extrabold tracking-[-0.3px] text-[#0a0a0a]">
        {formatDA(value)}
      </b>
    </div>
  );
}

/** Direction (flèche/couleur) + signe d'une ligne d'historique. */
function view(e: Entry): { dir: "up" | "dn"; sign: string } {
  switch (e.type) {
    case "driver_payout":
    case "driver_cash_collected":
      return { dir: "up", sign: "+" };
    case "driver_owes_merchant":
    case "driver_owes_platform":
      return { dir: "dn", sign: "-" };
    case "adjustment":
      return e.amount_da >= 0
        ? { dir: "up", sign: "+" }
        : { dir: "dn", sign: "-" };
  }
}

function typeLabel(t: Entry["type"]): string {
  switch (t) {
    case "driver_payout":
      return "Rémunération livraison";
    case "driver_cash_collected":
      return "Cash encaissé";
    case "driver_owes_merchant":
      return "Dû au commerçant";
    case "driver_owes_platform":
      return "Dû à la plateforme";
    case "adjustment":
      return "Ajustement";
  }
}
