// =============================================================================
// Format d'affichage de l'heure de récupération — UX dédié au public algérien.
// =============================================================================
// L'horaire 24h est OK en Algérie, mais on combine systématiquement avec :
//   - une indication RELATIVE (« dans ~15 min », « demain », « mardi 26 mai »)
//     pour réduire la charge mentale
//   - pour les slots, on affiche une PLAGE (« entre 14h00 et 14h30 ») plutôt
//     qu'un point précis — évite la frustration « j'étais à 14h32, raté ».
//
// BILINGUE FR/AR : maps codées en dur (PAS Intl — piège d'hydratation #418,
// cf. formatDA). Mois en arabe ALGÉRIEN (جانفي، فيفري…) — c'est l'usage local.
// `locale` est un paramètre optionnel de FIN (défaut "fr") → non cassant.
// =============================================================================

type Loc = string; // "fr" | "ar" (tout autre → fr)

const isAr = (locale: Loc) => locale === "ar";

/** « 14h32 » (fr) / « 14:32 » (ar). */
export function formatTimeFr(d: Date, locale: Loc = "fr"): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return isAr(locale) ? `${h}:${m}` : `${h}h${m}`;
}

/** « ~15 min », « 1h30 », « à l'instant » / arabe. null si négatif/passé. */
export function formatRelativeMinutes(
  date: Date,
  now: Date = new Date(),
  locale: Loc = "fr"
): string | null {
  const diffMin = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (diffMin < 0) return null;
  const ar = isAr(locale);
  if (diffMin === 0) return ar ? "الآن" : "à l'instant";
  if (diffMin < 60) return ar ? `~${diffMin} د` : `~${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (ar) return m === 0 ? `${h} سا` : `${h} سا ${m} د`;
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
// Index getDay() (0 = dimanche), comme DAYS_FR.
const DAYS_AR = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
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
// Mois en arabe ALGÉRIEN (usage local, pas les noms orientaux).
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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDaysFrom(now: Date, date: Date): number {
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000
  );
}

/** Jour relatif : « aujourd'hui », « demain », « mardi 26 mai » / arabe. */
export function formatDayRelative(
  date: Date,
  now: Date = new Date(),
  locale: Loc = "fr"
): string {
  const diffDays = diffDaysFrom(now, date);
  const ar = isAr(locale);
  if (diffDays === 0) return ar ? "اليوم" : "aujourd'hui";
  if (diffDays === 1) return ar ? "غدًا" : "demain";
  const days = ar ? DAYS_AR : DAYS_FR;
  const months = ar ? MONTHS_AR : MONTHS_FR;
  if (diffDays < 7) {
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Carte de JOUR du sélecteur de créneau : libellé court au-dessus + numéro du
 * jour en gros (« Auj. / 7 », « Dem. / 8 », « mer. / 9 » — arabe : « اليوم »,
 * « غدًا », « الأربعاء ») — scannable d'un coup d'œil, façon calendrier.
 */
export function formatDayCardParts(
  date: Date,
  locale: Loc = "fr",
  now: Date = new Date()
): { top: string; num: string } {
  const diffDays = diffDaysFrom(now, date);
  const ar = isAr(locale);
  const top =
    diffDays === 0
      ? ar
        ? "اليوم"
        : "Auj."
      : diffDays === 1
        ? ar
          ? "غدًا"
          : "Dem."
        : ar
          ? DAYS_AR[date.getDay()]
          : `${DAYS_FR[date.getDay()].slice(0, 3)}.`;
  return { top, num: String(date.getDate()) };
}

/**
 * Date + heure COMPLÈTES d'un événement passé — « 1 août 2026 · 17h06 »
 * (ar : « 1 أوت 2026 · 17:06 »). Pour la ligne « Commandée le » du détail de
 * commande. Fuseau ALGER forcé (UTC+1 sans DST, décalage manuel + getUTC*) :
 * cette chaîne se rend CÔTÉ SERVEUR, où Vercel tourne en UTC — `getHours()`
 * y donnerait une heure décalée d'une heure.
 */
export function formatOrderDateTime(date: Date, locale: Loc = "fr"): string {
  const d = new Date(date.getTime() + 3600_000); // Alger = UTC+1, sans DST
  const ar = isAr(locale);
  const months = ar ? MONTHS_AR : MONTHS_FR;
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const day = `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return ar ? `${day} · ${h}:${m}` : `${day} · ${h}h${m}`;
}

// -----------------------------------------------------------------------------
// Compositions prêtes à l'emploi.
// -----------------------------------------------------------------------------

/** ASAP : « Prêt dans ~15 min — vers 14h32 » / arabe. */
export function formatAsapReady(
  readyAt: Date,
  now: Date = new Date(),
  locale: Loc = "fr"
): string {
  const rel = formatRelativeMinutes(readyAt, now, locale);
  const abs = formatTimeFr(readyAt, locale);
  if (isAr(locale)) {
    return rel === null
      ? `جاهز حوالي ${abs}`
      : `جاهز خلال ${rel} — حوالي ${abs}`;
  }
  if (rel === null) return `Prêt vers ${abs}`;
  return `Prêt dans ${rel} — vers ${abs}`;
}

/**
 * Slot :
 *   - même jour : « Retrait entre 14h00 et 14h30 »
 *   - demain    : « Demain entre 10h00 et 10h30 »
 *   - 2j+       : « Mardi 26 mai entre 10h00 et 10h30 »
 * Arabe : « الاستلام من 14:00 إلى 14:30 », « غدًا من … إلى … ».
 */
export function formatSlotRange(
  start: Date,
  end: Date,
  now: Date = new Date(),
  locale: Loc = "fr"
): string {
  const day = formatDayRelative(start, now, locale);
  const t1 = formatTimeFr(start, locale);
  const t2 = formatTimeFr(end, locale);
  if (isAr(locale)) {
    return day === "اليوم"
      ? `الاستلام من ${t1} إلى ${t2}`
      : `${day} من ${t1} إلى ${t2}`;
  }
  const range = `entre ${t1} et ${t2}`;
  if (day === "aujourd'hui") return `Retrait ${range}`;
  // « Demain » et « Mardi 26 mai » — capitalisation initiale.
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1);
  return `${dayCap} ${range}`;
}
