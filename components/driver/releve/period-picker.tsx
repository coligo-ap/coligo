"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";

/**
 * Sélecteur de PÉRIODE du relevé : « Période en cours » (non réglé) + TOUS
 * les mois depuis la première activité (groupés par année — tient des années
 * d'ancienneté) + dates personnalisées. Chaque choix navigue par l'URL
 * (?month= / ?from=&to=) → la page ET le PDF affichent la même période.
 */

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

/** Liste YYYY-MM du plus récent au plus ancien, bornée au 1er mois d'activité. */
function monthsSince(firstMonth: string | null): string[] {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  const [fy, fm] = (firstMonth ?? `${y}-${String(m).padStart(2, "0")}`)
    .split("-")
    .map(Number);
  const out: string[] = [];
  // Garde-fou 20 ans (jamais de boucle infinie sur donnée corrompue).
  for (let i = 0; i < 240; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === fy && m === fm) break;
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function RelevePeriodPicker({
  firstMonth,
  selectedMonth,
  customFrom,
  customTo,
}: {
  firstMonth: string | null;
  /** YYYY-MM si un mois est sélectionné dans l'URL. */
  selectedMonth: string | null;
  customFrom: string | null;
  customTo: string | null;
}) {
  const router = useRouter();
  const isCustom = !!(customFrom && customTo);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

  const months = monthsSince(firstMonth);
  // Groupé par année → lisible même après des années d'activité.
  const byYear = new Map<string, string[]>();
  for (const mo of months) {
    const yr = mo.slice(0, 4);
    const arr = byYear.get(yr);
    if (arr) arr.push(mo);
    else byYear.set(yr, [mo]);
  }

  const value = isCustom ? "custom" : (selectedMonth ?? "current");
  const onSelect = (v: string) => {
    if (v === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    router.push(
      v === "current" ? "/driver/releve" : `/driver/releve?month=${v}`
    );
  };

  return (
    <div className="mb-3 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3">
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
        <CalendarDays className="size-3.5" />
        Période
      </label>
      <select
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5 text-[13.5px] font-semibold text-[var(--d-ink)] outline-none"
        style={{ fontFamily: SORA }}
      >
        <option value="current">Période en cours (non réglé)</option>
        {[...byYear.entries()].map(([yr, mos]) => (
          <optgroup key={yr} label={yr}>
            {mos.map((mo) => {
              const m = Number(mo.slice(5)) - 1;
              return (
                <option key={mo} value={mo}>
                  {MONTHS_FR[m]} {yr}
                </option>
              );
            })}
          </optgroup>
        ))}
        <option value="custom">Dates personnalisées…</option>
      </select>

      {showCustom && (
        <div className="mt-2.5 flex items-end gap-2">
          <label className="min-w-0 flex-1 text-[11px] font-semibold text-[var(--d-muted)]">
            Du
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-2.5 py-2 text-[13px] text-[var(--d-ink)] outline-none"
            />
          </label>
          <label className="min-w-0 flex-1 text-[11px] font-semibold text-[var(--d-muted)]">
            Au
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-2.5 py-2 text-[13px] text-[var(--d-ink)] outline-none"
            />
          </label>
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => router.push(`/driver/releve?from=${from}&to=${to}`)}
            className="h-[38px] shrink-0 rounded-[12px] px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50"
            style={{ fontFamily: SORA, background: BRAND_VIOLET }}
          >
            Afficher
          </button>
        </div>
      )}
    </div>
  );
}
