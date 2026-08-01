"use client";

// =============================================================================
// « Ne plus me montrer la roue AUJOURD'HUI » — règle partagée par la bulle
// flottante et le bandeau de l'accueil.
//
// Un seul endroit décide, sinon fermer l'un ne ferait rien à l'autre et le
// client aurait l'impression que son geste n'a pas été pris en compte.
//
// Le retour se fait au CHANGEMENT DE JOUR (pas après un délai) : c'est ce que
// font Temu et Shein, et c'est ce que les gens attendent — « demain, on verra ».
// Stockage local CLÉ PAR COMPTE : deux personnes sur le même téléphone ne
// partagent pas leur choix.
// =============================================================================

const KEY = "coligo:wheel-bubble";

type Store = Record<string, { dismissedOn?: string; x?: number; y?: number }>;

/** Jour civil local — repère volontairement simple et lisible. */
export function wheelToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function readWheelStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

export function writeWheelStore(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : la roue se comportera comme au premier jour */
  }
}

/** La roue a-t-elle été écartée aujourd'hui par ce compte ? */
export function isWheelDismissedToday(uid: string | null): boolean {
  if (!uid) return false;
  return readWheelStore()[uid]?.dismissedOn === wheelToday();
}

/** L'écarter jusqu'à demain (bulle ET bandeau : même geste, même effet). */
export function dismissWheelToday(uid: string | null): void {
  if (!uid) return;
  const s = readWheelStore();
  s[uid] = { ...(s[uid] ?? {}), dismissedOn: wheelToday() };
  writeWheelStore(s);
}
