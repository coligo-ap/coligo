// =============================================================================
// Génération des créneaux de retrait à partir des horaires d'ouverture.
// =============================================================================
// Pure : entrées (opening_hours + jour + slot duration + prep) → liste de
// créneaux futurs alignés à la granularité demandée.
//
// Supporte les horaires de NUIT (close <= open) : un créneau ouvert ce soir et
// fermé tôt le matin → on continue à proposer des slots jusqu'à la fermeture,
// même au-delà de minuit (ce qui peut tomber sur "demain" côté Date).

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
 * Génère les créneaux disponibles à partir de maintenant (+ délai prep),
 * bornés par les heures d'ouverture du jour courant et — si le commerce est
 * ouvert en horaire de nuit — du créneau de la VEILLE qui s'étend dans la
 * matinée d'aujourd'hui.
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

  // On agrège les périodes pertinentes pour AUJOURD'HUI :
  //  1) les périodes du jour courant (overnight comprises — leur fin tombera
  //     sur demain mais on l'autorise).
  //  2) les périodes overnight de HIER qui débordent sur ce matin.
  const today = JS_DAY_TO_KEY[now.getDay()];
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yKey = JS_DAY_TO_KEY[yesterday.getDay()];

  type Period = { start: Date; end: Date };
  const periods: Period[] = [];

  for (const p of hours[today] ?? []) {
    const [openH, openM] = p.open.split(":").map(Number);
    const [closeH, closeM] = p.close.split(":").map(Number);
    const start = new Date(now);
    start.setHours(openH, openM, 0, 0);
    const end = new Date(now);
    end.setHours(closeH, closeM, 0, 0);
    // Overnight : close <= open → la fin est le lendemain.
    if (end.getTime() <= start.getTime()) {
      end.setDate(end.getDate() + 1);
    }
    periods.push({ start, end });
  }

  for (const p of hours[yKey] ?? []) {
    const [openH, openM] = p.open.split(":").map(Number);
    const [closeH, closeM] = p.close.split(":").map(Number);
    // Seulement les overnight de hier qui débordent ce matin.
    if (p.close > p.open) continue;
    const start = new Date(yesterday);
    start.setHours(openH, openM, 0, 0);
    const end = new Date(now); // close = ce matin
    end.setHours(closeH, closeM, 0, 0);
    periods.push({ start, end });
  }

  const earliest = new Date(now.getTime() + opts.prepMinutes * 60_000);
  const slots: Slot[] = [];
  const limit = opts.limit ?? 16;

  for (const period of periods) {
    let cursor = new Date(Math.max(period.start.getTime(), earliest.getTime()));
    // Aligne sur la granularité.
    const minutes = cursor.getMinutes();
    const rem = minutes % opts.slotMinutes;
    if (rem > 0) {
      cursor = new Date(cursor.getTime() + (opts.slotMinutes - rem) * 60_000);
      cursor.setSeconds(0, 0);
    } else {
      cursor.setSeconds(0, 0);
    }

    while (
      cursor.getTime() + opts.slotMinutes * 60_000 <= period.end.getTime() &&
      slots.length < limit
    ) {
      const end = new Date(cursor.getTime() + opts.slotMinutes * 60_000);
      const hh = String(cursor.getHours()).padStart(2, "0");
      const mm = String(cursor.getMinutes()).padStart(2, "0");
      // Si le créneau démarre demain (overnight qui dépasse minuit), on
      // ajoute un suffixe pour que le client ne se trompe pas de jour.
      const startsTomorrow = cursor.getDate() !== now.getDate();
      slots.push({
        start: new Date(cursor),
        end,
        label: startsTomorrow ? `${hh}h${mm} (demain)` : `${hh}h${mm}`,
      });
      cursor = end;
    }
  }

  // Tri chronologique pour mixer proprement hier-overnight + aujourd'hui.
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots.slice(0, limit);
}

/**
 * Génère les créneaux sur N jours à partir d'aujourd'hui. Utilisé pour la
 * programmation J+N (commande pour demain, après-demain, etc.).
 *
 * Renvoie une Map jour-clé (`YYYY-MM-DD`) → slots de ce jour. Permet à l'UI
 * d'afficher un sélecteur de date séparé du sélecteur d'horaire.
 *
 * - daysAhead=0 → uniquement aujourd'hui (équivalent à generateTodaySlots).
 * - daysAhead=7 → 8 jours au total (aujourd'hui + 7 jours suivants).
 */
export function generateSlotsForRange(
  hours: OpeningHours,
  opts: {
    slotMinutes: number;
    prepMinutes: number;
    daysAhead: number;
    now?: Date;
    perDayLimit?: number;
  }
): Map<string, Slot[]> {
  const now = opts.now ?? new Date();
  const perDayLimit = opts.perDayLimit ?? 32;
  const out = new Map<string, Slot[]>();

  for (let offset = 0; offset <= opts.daysAhead; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    // Pour J=0 on prend "maintenant" (avec le délai prep) ; pour J>0 on
    // démarre à minuit, ce qui permet d'avoir tous les créneaux du jour.
    const dayNow = offset === 0 ? now : new Date(day.setHours(0, 0, 0, 0));
    const slots = generateTodaySlots(hours, {
      slotMinutes: opts.slotMinutes,
      prepMinutes: opts.prepMinutes,
      now: dayNow,
      limit: perDayLimit,
    });
    // Filtre : ne garder que les slots qui démarrent ce JOUR-LÀ (les overnights
    // qui débordent finiront naturellement dans le jour suivant grâce à la
    // boucle).
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + offset);
    const targetKey = ymdKey(targetDate);
    const filtered = slots.filter((s) => ymdKey(s.start) === targetKey);
    if (filtered.length > 0) out.set(targetKey, filtered);
  }

  return out;
}

/** "YYYY-MM-DD" en local time — clé stable pour grouper les slots. */
export function ymdKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
