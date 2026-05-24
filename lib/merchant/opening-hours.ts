// =============================================================================
// Horaires d'ouverture — helpers PURS (calcul à la volée, jamais stocké).
// =============================================================================
// Le drapeau "ouvert maintenant" N'EST PAS persisté en base : il dérive
// strictement de `opening_hours` et de l'heure courante. Toute logique
// d'affichage / contrôle d'accès passe par `isOpenNow()`.
//
// Horaires de NUIT (overnight) :
//   Un créneau dont `close <= open` est considéré comme passant minuit :
//     ex. { open: "22:00", close: "03:00" } → ouvert de 22h aujourd'hui à 3h
//     du matin demain. Très courant pour les cafés/fast-foods/boulangeries
//     algériennes ouvertes tard.

import {
  DAY_KEYS,
  EMPTY_OPENING_HOURS,
  type DayKey,
  type OpeningHours,
  type OpeningSlot,
} from "@/lib/types";

// Date.getDay() → JS dimanche=0, lundi=1, ... samedi=6
// On veut un index dans DAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"].
const JS_DAY_TO_KEY: Record<number, DayKey> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

/** Renvoie "HH:MM" pour une date donnée. */
function hhmm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** True si le créneau passe minuit (ferme le lendemain). */
export function isOvernight(slot: OpeningSlot): boolean {
  return slot.close <= slot.open;
}

/** Normalise un opening_hours potentiellement partiel / null. */
export function normalizeOpeningHours(
  input: Partial<OpeningHours> | null | undefined
): OpeningHours {
  if (!input) return { ...EMPTY_OPENING_HOURS };
  const out: OpeningHours = { ...EMPTY_OPENING_HOURS };
  for (const k of DAY_KEYS) {
    const slots = Array.isArray(input[k]) ? input[k]! : [];
    out[k] = slots
      .filter((s) => isValidSlot(s))
      .map((s) => ({ open: s.open, close: s.close }));
  }
  return out;
}

/**
 * Vérifie qu'un slot a des heures bien formées et distinctes.
 * Accepte les horaires de nuit (close < open = ferme le lendemain).
 * Refuse uniquement open === close (créneau vide / ambigu).
 */
export function isValidSlot(s: OpeningSlot | undefined | null): boolean {
  if (!s || typeof s.open !== "string" || typeof s.close !== "string") {
    return false;
  }
  if (!/^\d{2}:\d{2}$/.test(s.open) || !/^\d{2}:\d{2}$/.test(s.close)) {
    return false;
  }
  return s.open !== s.close;
}

/**
 * Renvoie `true` si l'heure `now` tombe dans `slot`. Gère les overnight :
 *   - simple : open <= now < close
 *   - overnight : now >= open OU now < close
 */
function slotContainsNow(slot: OpeningSlot, now: string): boolean {
  if (isOvernight(slot)) {
    return now >= slot.open || now < slot.close;
  }
  return slot.open <= now && now < slot.close;
}

/**
 * Pour un créneau overnight ouvert HIER, il reste ouvert AUJOURD'HUI tant que
 * l'heure courante est strictement < close. (La partie "open..24h" est déjà
 * comptée hier.)
 */
function overnightFromYesterdayStillOpen(
  slot: OpeningSlot,
  now: string
): boolean {
  return isOvernight(slot) && now < slot.close;
}

/**
 * Renvoie l'instant courant TRADUIT au fuseau Africa/Algiers — utile côté
 * serveur (Vercel = UTC) pour calculer ouvert/fermé en heure locale.
 *
 * Astuce : on construit la date via `Intl.DateTimeFormat` en fixant la zone
 * cible, puis on relie les parties (jour/h/min) à un objet Date interprété
 * localement. Le résultat est utilisable comme une "Date dans Africa/Algiers".
 */
export function nowInAlgiers(): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  // weekday "short" en en-US : Sun/Mon/.../Sat
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const d = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  // Force getDay() à correspondre à Alger (les autres méthodes sont déjà
  // cohérentes via les valeurs locales injectées).
  void dayMap;
  return d;
}

/** Renvoie `true` si le commerce est ouvert AU MOMENT donné (par défaut now). */
export function isOpenNow(
  hours: OpeningHours | null | undefined,
  at: Date = new Date()
): boolean {
  if (!hours) return false;
  const now = hhmm(at);

  // Aujourd'hui : un créneau classique OU un overnight démarré ce soir.
  const todayKey = JS_DAY_TO_KEY[at.getDay()];
  const todaySlots = hours[todayKey] ?? [];
  if (todaySlots.some((s) => slotContainsNow(s, now))) return true;

  // Hier : un créneau overnight démarré hier soir peut encore être actif si on
  // est dans la tranche [00:00 .. close].
  const yesterday = new Date(at);
  yesterday.setDate(at.getDate() - 1);
  const yKey = JS_DAY_TO_KEY[yesterday.getDay()];
  const ySlots = hours[yKey] ?? [];
  if (ySlots.some((s) => overnightFromYesterdayStillOpen(s, now))) return true;

  return false;
}

/**
 * Renvoie le prochain créneau d'ouverture (jour + slot) après `at`.
 * Considère un créneau overnight encore actif comme "déjà en cours" → renverra
 * le suivant.
 */
export function nextOpening(
  hours: OpeningHours | null | undefined,
  at: Date = new Date()
): { day: DayKey; slot: OpeningSlot } | null {
  if (!hours) return null;
  const now = hhmm(at);
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(at);
    day.setDate(at.getDate() + offset);
    const key = JS_DAY_TO_KEY[day.getDay()];
    const slots = (hours[key] ?? [])
      .slice()
      .sort((a, b) => a.open.localeCompare(b.open));
    for (const slot of slots) {
      // Aujourd'hui : on saute les créneaux dont l'ouverture est passée OU en
      // cours. Un overnight démarré aujourd'hui : si open <= now, déjà
      // démarré → suivant.
      if (offset === 0 && slot.open <= now) continue;
      return { day: key, slot };
    }
  }
  return null;
}
