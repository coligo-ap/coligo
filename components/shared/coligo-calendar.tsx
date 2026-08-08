"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * CALENDRIER COLIGO — grille mensuelle FLAT (tokens --d-*, zéro ombre) pour
 * choisir une DATE en un tap, sans le sélecteur natif illisible. Jour civil
 * d'Alger (UTC+1 sans DST), fenêtre aujourd'hui → +maxDays. FR/AR (RTL géré
 * par les flèches logiques). Partagé chauffeur + client.
 */

const VIOLET = "#6C2BD9";

/** Jour civil Alger au format YYYY-MM-DD, décalable. */
function algiersDay(offsetDays = 0): string {
  const local = new Date(Date.now() + 3600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + offsetDays
    )
  )
    .toISOString()
    .slice(0, 10);
}

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
// Semaine qui démarre LUNDI (repère habituel des apps).
const DAYS_FR = ["L", "M", "M", "J", "V", "S", "D"];
const DAYS_AR = ["ن", "ث", "ر", "خ", "ج", "س", "ح"];

export function ColigoCalendar({
  value,
  onChange,
  maxDays = 30,
}: {
  /** Date sélectionnée (YYYY-MM-DD) ou null. */
  value: string | null;
  onChange: (day: string) => void;
  /** Fenêtre autorisée : aujourd'hui → aujourd'hui + maxDays. */
  maxDays?: number;
}) {
  const isAr = useLocale() === "ar";
  const today = algiersDay(0);
  const maxDay = algiersDay(maxDays);

  // Mois affiché (année, mois 0-11) — démarre sur le mois de la sélection,
  // sinon le mois courant.
  const start = value ?? today;
  const [ym, setYm] = useState<[number, number]>([
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
  ]);

  const weeks = useMemo(() => {
    const [y, m] = ym;
    const first = new Date(Date.UTC(y, m, 1));
    // Décalage lundi-start : getUTCDay() 0=dim → 6, 1=lun → 0…
    const lead = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) =>
        new Date(Date.UTC(y, m, i + 1)).toISOString().slice(0, 10)
      ),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [ym]);

  const [y, m] = ym;
  const monthLabel = `${(isAr ? MONTHS_AR : MONTHS_FR)[m]} ${y}`;
  const canPrev = `${y}-${String(m + 1).padStart(2, "0")}` > today.slice(0, 7);
  const canNext = `${y}-${String(m + 1).padStart(2, "0")}` < maxDay.slice(0, 7);
  const move = (dir: 1 | -1) =>
    setYm(([yy, mm]) => {
      const d = new Date(Date.UTC(yy, mm + dir, 1));
      return [d.getUTCFullYear(), d.getUTCMonth()];
    });

  return (
    <div className="rounded-[10px] border border-[var(--d-line)] bg-[var(--d-surface)] p-2.5">
      {/* Mois + navigation */}
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canPrev && move(-1)}
          disabled={!canPrev}
          aria-label="←"
          className="grid size-8 place-items-center rounded-[8px] bg-[var(--d-soft)] disabled:opacity-30"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </button>
        <span className="drive-sora text-[13px] font-extrabold capitalize">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => canNext && move(1)}
          disabled={!canNext}
          aria-label="→"
          className="grid size-8 place-items-center rounded-[8px] bg-[var(--d-soft)] disabled:opacity-30"
        >
          <ChevronRight className="size-4 rtl:rotate-180" />
        </button>
      </div>
      {/* Jours de semaine */}
      <div className="grid grid-cols-7 text-center">
        {(isAr ? DAYS_AR : DAYS_FR).map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="py-1 text-[10px] font-bold text-[var(--d-muted)]"
          >
            {d}
          </span>
        ))}
      </div>
      {/* Grille */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, di) => {
            if (!day) return <span key={di} className="h-9" />;
            const disabled = day < today || day > maxDay;
            const selected = value === day;
            const isToday = day === today;
            return (
              <button
                key={day}
                type="button"
                disabled={disabled}
                onClick={() => onChange(day)}
                className="drive-sora mx-auto my-0.5 grid size-8 place-items-center rounded-[8px] text-[12.5px] font-bold transition-colors disabled:opacity-25"
                style={
                  selected
                    ? { background: VIOLET, color: "#fff" }
                    : isToday
                      ? {
                          border: `1.5px solid ${VIOLET}`,
                          color: VIOLET,
                        }
                      : { color: "var(--d-ink)" }
                }
              >
                {Number(day.slice(8, 10))}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Libellé court d'un jour (ven. 15 août / الجمعة 15 أوت). */
export function dayLabel(day: string | null, isAr: boolean): string {
  if (!day) return "—";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(
    isAr ? "ar-DZ" : "fr-DZ",
    { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }
  );
}

/** Sélecteur d'HEURE séparé (HH : MM au pas de 15 min) — flat Coligo. */
export function TimeSelect({
  hour,
  minute,
  onChange,
}: {
  hour: string;
  minute: string;
  onChange: (h: string, m: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={hour}
        onChange={(e) => onChange(e.target.value, minute)}
        className="drive-sora h-11 flex-1 rounded-[10px] border border-[var(--d-line)] bg-[var(--d-soft)] px-2 text-center text-[15px] font-extrabold outline-none"
        aria-label="HH"
      >
        {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map(
          (h) => (
            <option key={h} value={h}>
              {h}
            </option>
          )
        )}
      </select>
      <span className="drive-sora text-[15px] font-extrabold">:</span>
      <select
        value={minute}
        onChange={(e) => onChange(hour, e.target.value)}
        className="drive-sora h-11 flex-1 rounded-[10px] border border-[var(--d-line)] bg-[var(--d-soft)] px-2 text-center text-[15px] font-extrabold outline-none"
        aria-label="MM"
      >
        {["00", "15", "30", "45"].map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </div>
  );
}
