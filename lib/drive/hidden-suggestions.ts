"use client";

// =============================================================================
// Suggestions de destination MASQUÉES par le client (accueil Drive).
//
// Les suggestions viennent de l'historique de courses : on ne peut donc pas
// les « supprimer » — effacer une course serait mentir sur ce qui s'est passé.
// Ce que le client demande en réalité, c'est de ne plus VOIR une destination
// dans ses raccourcis. On garde donc la course et on masque la ligne.
//
// Stockage local, CLÉ PAR COMPTE (règle du projet : jamais de cache partagé
// entre deux comptes sur le même téléphone). Rien de sensible : uniquement le
// libellé d'une adresse déjà affichée à cet utilisateur.
// =============================================================================

const KEY = "coligo:drive:hidden-dests";
const MAX = 40; // garde-fou : au-delà, on oublie les plus anciennes

type Store = Record<string, string[]>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage plein ou navigation privée : le masquage vaut pour la session */
  }
}

/** Libellés masqués par ce compte. */
export function getHiddenDests(uid: string | null): string[] {
  if (!uid) return [];
  return read()[uid] ?? [];
}

/** Masque une destination. Idempotent. */
export function hideDest(uid: string | null, text: string): void {
  if (!uid || !text) return;
  const s = read();
  const list = s[uid] ?? [];
  if (list.includes(text)) return;
  s[uid] = [text, ...list].slice(0, MAX);
  write(s);
}

/** Réaffiche tout (« Tout réafficher » — on ne piège jamais un choix). */
export function clearHiddenDests(uid: string | null): void {
  if (!uid) return;
  const s = read();
  delete s[uid];
  write(s);
}
