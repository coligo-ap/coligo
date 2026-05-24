// =============================================================================
// Format d'affichage de l'heure de récupération — UX dédié au public algérien.
// =============================================================================
// L'horaire 24h est OK en Algérie, mais on combine systématiquement avec :
//   - une indication RELATIVE (« dans ~15 min », « demain », « mardi 26 mai »)
//     pour réduire la charge mentale
//   - pour les slots, on affiche une PLAGE (« entre 14h00 et 14h30 ») plutôt
//     qu'un point précis — évite la frustration « j'étais à 14h32, raté ».
//
// Le format « 14h00 » est préféré à « 14:00 » : plus naturel pour la lecture
// quotidienne en Algérie (alignement avec la signalétique grand public).
// =============================================================================

/** « 14h32 » au lieu de « 14:32 ». */
export function formatTimeFr(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}h${m}`;
}

/** « ~15 min », « 1h30 », « <1 min ». Renvoie null si négatif/passé. */
export function formatRelativeMinutes(
  date: Date,
  now: Date = new Date()
): string | null {
  const diffMin = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (diffMin < 0) return null;
  if (diffMin === 0) return "à l'instant";
  if (diffMin < 60) return `~${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

const DAYS_FR = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];
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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Jour relatif : « aujourd'hui », « demain », « mardi 26 mai ». */
export function formatDayRelative(date: Date, now: Date = new Date()): string {
  const a = startOfDay(now).getTime();
  const b = startOfDay(date).getTime();
  const diffDays = Math.round((b - a) / 86_400_000);
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return "demain";
  if (diffDays < 7) {
    return `${DAYS_FR[date.getDay()]} ${date.getDate()} ${MONTHS_FR[date.getMonth()]}`;
  }
  return `${date.getDate()} ${MONTHS_FR[date.getMonth()]}`;
}

// -----------------------------------------------------------------------------
// Compositions prêtes à l'emploi.
// -----------------------------------------------------------------------------

/** ASAP : « Prêt dans ~15 min — vers 14h32 ». */
export function formatAsapReady(readyAt: Date, now: Date = new Date()): string {
  const rel = formatRelativeMinutes(readyAt, now);
  const abs = formatTimeFr(readyAt);
  if (rel === null) return `Prêt vers ${abs}`;
  return `Prêt dans ${rel} — vers ${abs}`;
}

/**
 * Slot :
 *   - même jour : « Retrait entre 14h00 et 14h30 »
 *   - demain    : « Demain entre 10h00 et 10h30 »
 *   - 2j+       : « Mardi 26 mai entre 10h00 et 10h30 »
 */
export function formatSlotRange(
  start: Date,
  end: Date,
  now: Date = new Date()
): string {
  const day = formatDayRelative(start, now);
  const range = `entre ${formatTimeFr(start)} et ${formatTimeFr(end)}`;
  if (day === "aujourd'hui") return `Retrait ${range}`;
  // « Demain » et « Mardi 26 mai » — capitalisation initiale.
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1);
  return `${dayCap} ${range}`;
}
