import { nowInAlgiers } from "@/lib/merchant/opening-hours";

/**
 * Date du jour (`YYYY-MM-DD`) + heure courante (`HH:MM`) au fuseau
 * Africa/Algiers. Côté serveur Vercel (UTC), comparer un créneau à `new Date()`
 * brut décalerait d'une heure → on passe par l'heure murale d'Alger.
 */
export function algiersDateAndTime(): { date: string; time: string } {
  const d = nowInAlgiers();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

/**
 * Vrai si le créneau est déjà écoulé : date passée, ou aujourd'hui mais heure de
 * FIN dépassée — évalué en heure locale d'Alger. Sert à masquer un créneau
 * périmé côté commerçant comme côté client (le filtre SQL ne porte que sur la
 * date, pas l'heure).
 */
export function isSlotExpired(
  slot: { slot_date: string; end_time: string },
  ref: { date: string; time: string } = algiersDateAndTime()
): boolean {
  if (slot.slot_date < ref.date) return true;
  if (slot.slot_date > ref.date) return false;
  return slot.end_time.slice(0, 5) <= ref.time;
}
