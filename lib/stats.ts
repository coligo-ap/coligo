// Logique de périodes et de regroupement pour la page /stats.
// Aucune table : tout est calculé depuis orders / order_items.

export type StatsPeriod = "today" | "7d" | "30d" | "12m";

export const STATS_PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
  { key: "12m", label: "12 mois" },
];

export function parsePeriod(value: string | undefined): StatsPeriod {
  // Défaut = « Aujourd'hui » : le commerçant veut d'abord voir sa journée.
  return STATS_PERIODS.some((p) => p.key === value)
    ? (value as StatsPeriod)
    : "today";
}

const MONTHS_FR = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

export type Granularity = "hour" | "day" | "month";

export type PeriodConfig = {
  start: Date; // début période courante (inclus)
  end: Date; // = maintenant
  prevStart: Date; // début période précédente (inclus)
  granularity: Granularity;
  count: number; // nombre de tranches
};

/** Calcule les bornes de la période courante et de la précédente. */
export function periodConfig(
  period: StatsPeriod,
  now = new Date()
): PeriodConfig {
  const start = new Date(now);
  const prevStart = new Date(now);

  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    prevStart.setTime(start.getTime());
    prevStart.setDate(prevStart.getDate() - 1);
    return { start, end: now, prevStart, granularity: "hour", count: 24 };
  }

  if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    prevStart.setTime(start.getTime());
    prevStart.setDate(prevStart.getDate() - days);
    return { start, end: now, prevStart, granularity: "day", count: days };
  }

  // 12 mois
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() - 11);
  prevStart.setTime(start.getTime());
  prevStart.setMonth(prevStart.getMonth() - 12);
  return { start, end: now, prevStart, granularity: "month", count: 12 };
}

export type Bucket = { label: string; ca: number };

/** Tranches vides étiquetées (heure / jour / mois). */
export function buildBuckets(cfg: PeriodConfig): Bucket[] {
  const buckets: Bucket[] = [];
  for (let i = 0; i < cfg.count; i++) {
    let label: string;
    if (cfg.granularity === "hour") {
      label = `${String(i).padStart(2, "0")}h`;
    } else if (cfg.granularity === "day") {
      const d = new Date(cfg.start);
      d.setDate(d.getDate() + i);
      label = `${d.getDate()}/${d.getMonth() + 1}`;
    } else {
      const d = new Date(cfg.start);
      d.setMonth(d.getMonth() + i);
      label = MONTHS_FR[d.getMonth()];
    }
    buckets.push({ label, ca: 0 });
  }
  return buckets;
}

/** Index de tranche pour une date donnée (−1 hors période courante). */
export function bucketIndex(cfg: PeriodConfig, date: Date): number {
  if (date < cfg.start || date > cfg.end) return -1;
  if (cfg.granularity === "hour") return date.getHours();
  if (cfg.granularity === "day") {
    const day = 86_400_000;
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return Math.round((startOfDay.getTime() - cfg.start.getTime()) / day);
  }
  return (
    (date.getFullYear() - cfg.start.getFullYear()) * 12 +
    (date.getMonth() - cfg.start.getMonth())
  );
}

/** Variation en % entre deux valeurs (null si pas de base de comparaison). */
export function variationPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
