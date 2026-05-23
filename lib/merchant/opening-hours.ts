// =============================================================================
// Horaires d'ouverture — helpers PURS (calcul à la volée, jamais stocké).
// =============================================================================
// Le drapeau "ouvert maintenant" N'EST PAS persisté en base : il dérive
// strictement de `opening_hours` et de l'heure courante. Toute logique
// d'affichage / contrôle d'accès passe par `isOpenNow()`.

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

/** Vérifie qu'un slot a des heures bien formées et cohérentes (open < close). */
export function isValidSlot(s: OpeningSlot | undefined | null): boolean {
  if (!s || typeof s.open !== "string" || typeof s.close !== "string") {
    return false;
  }
  if (!/^\d{2}:\d{2}$/.test(s.open) || !/^\d{2}:\d{2}$/.test(s.close)) {
    return false;
  }
  return s.open < s.close;
}

/** Renvoie `true` si le commerce est ouvert AU MOMENT donné (par défaut now). */
export function isOpenNow(
  hours: OpeningHours | null | undefined,
  at: Date = new Date()
): boolean {
  if (!hours) return false;
  const key = JS_DAY_TO_KEY[at.getDay()];
  const slots = hours[key] ?? [];
  const now = hhmm(at);
  return slots.some((s) => s.open <= now && now < s.close);
}

/** Renvoie le prochain créneau d'ouverture (jour + slot) après `at`. */
export function nextOpening(
  hours: OpeningHours | null | undefined,
  at: Date = new Date()
): { day: DayKey; slot: OpeningSlot } | null {
  if (!hours) return null;
  const now = hhmm(at);
  // Jour courant : chercher un slot qui n'est pas encore commencé.
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(at);
    day.setDate(at.getDate() + offset);
    const key = JS_DAY_TO_KEY[day.getDay()];
    const slots = (hours[key] ?? [])
      .slice()
      .sort((a, b) => a.open.localeCompare(b.open));
    for (const slot of slots) {
      if (offset === 0 && slot.open <= now) continue;
      return { day: key, slot };
    }
  }
  return null;
}
