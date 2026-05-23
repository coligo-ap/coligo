// =============================================================================
// Génération des créneaux de retrait à partir des horaires d'ouverture.
// =============================================================================
// Pure : entrées (opening_hours + jour + slot duration + prep) → liste de
// créneaux futurs alignés à la granularité demandée.

import type { OpeningHours, DayKey } from "@/lib/types";

const JS_DAY_TO_KEY: Record<number, DayKey> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

export type Slot = {
  start: Date;
  end: Date;
  /** "HH:MM" — pour affichage rapide. */
  label: string;
};

/**
 * Génère les créneaux disponibles pour AUJOURD'HUI à partir de maintenant
 * (+ délai prep), bornés par les heures d'ouverture du jour, à la granularité
 * `slotMinutes`. Renvoie max `limit` créneaux.
 */
export function generateTodaySlots(
  hours: OpeningHours,
  opts: {
    slotMinutes: number;
    prepMinutes: number;
    now?: Date;
    limit?: number;
  }
): Slot[] {
  const now = opts.now ?? new Date();
  const day = JS_DAY_TO_KEY[now.getDay()];
  const periods = hours[day] ?? [];
  if (periods.length === 0) return [];

  // Premier créneau possible = max(maintenant + prep, début de période).
  const earliest = new Date(now.getTime() + opts.prepMinutes * 60_000);

  const slots: Slot[] = [];
  const limit = opts.limit ?? 16;

  for (const period of periods) {
    const [openH, openM] = period.open.split(":").map(Number);
    const [closeH, closeM] = period.close.split(":").map(Number);
    const periodStart = new Date(now);
    periodStart.setHours(openH, openM, 0, 0);
    const periodEnd = new Date(now);
    periodEnd.setHours(closeH, closeM, 0, 0);

    // Aligne le premier slot sur la granularité.
    let cursor = new Date(Math.max(periodStart.getTime(), earliest.getTime()));
    // Roundup vers le prochain pas.
    const minutes = cursor.getMinutes();
    const rem = minutes % opts.slotMinutes;
    if (rem > 0) {
      cursor = new Date(cursor.getTime() + (opts.slotMinutes - rem) * 60_000);
      cursor.setSeconds(0, 0);
    } else {
      cursor.setSeconds(0, 0);
    }

    while (
      cursor.getTime() + opts.slotMinutes * 60_000 <= periodEnd.getTime() &&
      slots.length < limit
    ) {
      const end = new Date(cursor.getTime() + opts.slotMinutes * 60_000);
      const hh = String(cursor.getHours()).padStart(2, "0");
      const mm = String(cursor.getMinutes()).padStart(2, "0");
      slots.push({
        start: new Date(cursor),
        end,
        label: `${hh}:${mm}`,
      });
      cursor = end;
    }
  }
  return slots;
}
