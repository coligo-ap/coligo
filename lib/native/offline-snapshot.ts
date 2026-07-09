"use client";

/**
 * Instantané « dernières informations connues », lisible HORS LIGNE.
 *
 * Pourquoi le stockage NATIF et pas localStorage / IndexedDB / Cache API :
 * quand le réseau est coupé au démarrage, Capacitor n'arrive pas à charger
 * `coligo.app` et bascule sur `server.errorPath`, une page embarquée dans
 * l'APK. Cette page est servie sur `https://localhost` — une ORIGINE
 * DIFFÉRENTE. Elle ne peut donc lire aucun stockage web écrit par coligo.app.
 * Le seul canal partagé entre les deux origines est le pont Capacitor, d'où
 * `@capacitor/preferences` (SharedPreferences côté Android).
 *
 * Ce module n'écrit JAMAIS de secret. Pas de code de retrait (pickup_code),
 * pas de jeton, pas d'adresse. Uniquement de quoi rassurer et orienter :
 * « ta commande #A12 chez Boucherie El Hidhab est en préparation ».
 *
 * Le serveur reste la source de vérité. Cet instantané est un repli d'affichage,
 * jamais une entrée de décision.
 */

import { isNative } from "@/lib/native/context";

/** Clé lue par capacitor-webroot/offline.html. Ne pas renommer sans lui. */
export const OFFLINE_SNAPSHOT_KEY = "coligo.offline.snapshot";

/** Version du format : la page hors-ligne refuse un instantané qu'elle ne sait pas lire. */
const SNAPSHOT_VERSION = 1;

/** Au-delà, l'information est trop vieille pour être montrée sans mentir. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type OfflineSnapshotOrder = {
  /** Numéro visible par le client (JAMAIS le pickup_code, qui est secret). */
  number: string | null;
  /** Libellé DÉJÀ TRADUIT : la page hors-ligne est statique, sans next-intl. */
  label: string;
  merchant: string;
  fulfillment: "pickup" | "delivery";
};

export type OfflineSnapshot = {
  v: number;
  /** Horodatage d'écriture, en ms epoch. La page hors-ligne affiche l'âge. */
  at: number;
  orders: OfflineSnapshotOrder[];
};

type PreferencesPlugin = {
  set: (o: { key: string; value: string }) => Promise<void>;
  get: (o: { key: string }) => Promise<{ value: string | null }>;
  remove: (o: { key: string }) => Promise<void>;
};

/**
 * Accès au plugin SANS l'importer statiquement : le bundle web (navigateur,
 * PWA) ne doit pas embarquer de code Capacitor, et `@capacitor/preferences`
 * n'existe qu'à l'exécution dans l'APK.
 */
function getPreferences(): PreferencesPlugin | null {
  if (typeof window === "undefined" || !isNative()) return null;
  const plugins = (
    window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }
  ).Capacitor?.Plugins;
  const prefs = plugins?.Preferences as PreferencesPlugin | undefined;
  return prefs ?? null;
}

/** Dernière charge écrite, pour ne pas réécrire à chaque tick de polling. */
let lastWritten = "";

/**
 * Dépose l'instantané. No-op hors APK, et no-op si rien n'a changé.
 * N'échoue jamais : un repli d'affichage ne doit pas casser l'app.
 */
export async function writeOfflineSnapshot(
  orders: OfflineSnapshotOrder[]
): Promise<void> {
  const prefs = getPreferences();
  if (!prefs) return;

  // On compare AVANT d'horodater : sinon `at` change à chaque appel et la
  // charge n'est jamais identique, donc on écrirait toutes les 20 s.
  const body = JSON.stringify(orders);
  if (body === lastWritten) return;

  const snapshot: OfflineSnapshot = {
    v: SNAPSHOT_VERSION,
    at: Date.now(),
    orders,
  };
  try {
    await prefs.set({
      key: OFFLINE_SNAPSHOT_KEY,
      value: JSON.stringify(snapshot),
    });
    lastWritten = body;
  } catch {
    /* stockage natif indisponible : on se tait, ce n'est qu'un confort */
  }
}

/** Efface l'instantané (déconnexion, suppression de compte). */
export async function clearOfflineSnapshot(): Promise<void> {
  const prefs = getPreferences();
  if (!prefs) return;
  try {
    await prefs.remove({ key: OFFLINE_SNAPSHOT_KEY });
    lastWritten = "";
  } catch {
    /* ignoré */
  }
}
