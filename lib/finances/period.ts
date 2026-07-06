// =============================================================================
// Préréglages de période « Finances » — résolution PURE en bornes ISO [from, to).
// =============================================================================
// Toutes les bornes sont calculées en heure d'ALGER. L'Algérie est à UTC+1
// FIXE (pas d'heure d'été) → un décalage constant de +01:00 est exact et
// déterministe serveur/navigateur (même règle que formatDA / React #418).
// =============================================================================

export type PeriodKey =
  | "today"
  | "week"
  | "month"
  | "prev-month"
  | "3m"
  | "year"
  | "custom";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
  { value: "prev-month", label: "Mois précédent" },
  { value: "3m", label: "3 derniers mois" },
  { value: "year", label: "Cette année" },
  { value: "custom", label: "Période personnalisée" },
];

const HOUR_MS = 3_600_000;

/** Minuit Alger d'un (année, mois 0-based, jour) → ISO UTC. Les valeurs hors
 *  bornes (jour 0, mois 12…) sont normalisées par Date.UTC. */
function algiersMidnightIso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d) - HOUR_MS).toISOString();
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ResolvedPeriod = {
  key: PeriodKey;
  fromIso: string;
  toIso: string;
};

/**
 * Résout un préréglage (ou des dates libres AAAA-MM-JJ) en bornes ISO
 * [fromIso, toIso). Entrée invalide → repli sur « Ce mois » (défaut produit).
 */
export function resolvePeriod(
  raw: string | undefined,
  from?: string,
  to?: string,
  now: Date = new Date()
): ResolvedPeriod {
  // Date courante vue d'Alger : on décale de +1 h puis on lit les champs UTC.
  const local = new Date(now.getTime() + HOUR_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  if (raw === "custom" && from && to && DAY_RE.test(from) && DAY_RE.test(to)) {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const fromIso = algiersMidnightIso(fy, fm - 1, fd);
    const toIso = algiersMidnightIso(ty, tm - 1, td + 1); // borne exclusive
    if (fromIso < toIso) return { key: "custom", fromIso, toIso };
  }

  switch (raw) {
    case "today":
      return {
        key: "today",
        fromIso: algiersMidnightIso(y, m, d),
        toIso: algiersMidnightIso(y, m, d + 1),
      };
    case "week": {
      // Semaine commençant le LUNDI (usage DZ/FR).
      const dow = local.getUTCDay(); // 0 = dimanche
      const monday = d - ((dow + 6) % 7);
      return {
        key: "week",
        fromIso: algiersMidnightIso(y, m, monday),
        toIso: algiersMidnightIso(y, m, monday + 7),
      };
    }
    case "prev-month":
      return {
        key: "prev-month",
        fromIso: algiersMidnightIso(y, m - 1, 1),
        toIso: algiersMidnightIso(y, m, 1),
      };
    case "3m":
      // 3 mois glissants pleins : du 1er de M-2 à la fin du mois courant.
      return {
        key: "3m",
        fromIso: algiersMidnightIso(y, m - 2, 1),
        toIso: algiersMidnightIso(y, m + 1, 1),
      };
    case "year":
      return {
        key: "year",
        fromIso: algiersMidnightIso(y, 0, 1),
        toIso: algiersMidnightIso(y + 1, 0, 1),
      };
    case "month":
    default:
      return {
        key: "month",
        fromIso: algiersMidnightIso(y, m, 1),
        toIso: algiersMidnightIso(y, m + 1, 1),
      };
  }
}
