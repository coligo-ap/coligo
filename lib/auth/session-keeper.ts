"use client";

import { createClient } from "@/lib/supabase/client";
import { isNative } from "@/lib/native/context";

// =============================================================================
// FILET DE SÉCURITÉ DE SESSION — « je reviens dans l'app et je suis déconnecté ».
//
// Symptôme signalé : après un paiement qui passe par une page externe, le client
// revient dans l'app et se retrouve « déconnecté » ; seule la fermeture COMPLÈTE
// puis réouverture de l'app lui rend sa session.
//
// Cause : `@supabase/ssr` range la session dans des COOKIES de la WebView. Quand
// l'app passe en arrière-plan, iOS peut recycler le processus de rendu et la
// WebView revient avec un magasin de cookies incomplet — les jetons sont pourtant
// toujours valides. Au redémarrage complet, la WebView relit les cookies du
// disque : la session « revient », d'où l'impression d'un bug aléatoire.
//
// Le filet : on garde une COPIE des jetons hors du magasin de cookies (Capacitor
// Preferences côté app, `localStorage` côté web) et, au retour au premier plan,
// si Supabase ne voit plus de session alors qu'on a une copie valide, on la
// RÉINSTALLE (`setSession` réécrit les cookies) — sans jamais demander à
// l'utilisateur de se reconnecter.
//
// Sécurité : on ne stocke QUE ce que le cookie contenait déjà (jetons d'accès et
// de rafraîchissement), sur l'appareil, et on EFFACE la copie à la déconnexion.
// Aucun secret nouveau n'est exposé, et le serveur reste seul juge (RLS).
// =============================================================================

const KEY = "coligo.session.backup";

type Backup = { access_token: string; refresh_token: string; at: number };

type PreferencesPlugin = {
  set: (o: { key: string; value: string }) => Promise<void>;
  get: (o: { key: string }) => Promise<{ value: string | null }>;
  remove: (o: { key: string }) => Promise<void>;
};

/** Plugin natif, sans import statique (le bundle web n'embarque pas Capacitor). */
function prefs(): PreferencesPlugin | null {
  if (typeof window === "undefined" || !isNative()) return null;
  const plugins = (
    window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }
  ).Capacitor?.Plugins;
  return (plugins?.Preferences as PreferencesPlugin | undefined) ?? null;
}

async function readBackup(): Promise<Backup | null> {
  try {
    const p = prefs();
    const raw = p
      ? (await p.get({ key: KEY })).value
      : window.localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup;
    if (!b?.access_token || !b?.refresh_token) return null;
    // Un jeton de rafraîchissement Supabase vit longtemps, mais une copie
    // oubliée depuis des mois n'a plus d'intérêt : on borne à 60 jours.
    if (Date.now() - (b.at ?? 0) > 60 * 24 * 3600 * 1000) return null;
    return b;
  } catch {
    return null;
  }
}

async function writeBackup(b: Backup): Promise<void> {
  try {
    const raw = JSON.stringify(b);
    const p = prefs();
    if (p) await p.set({ key: KEY, value: raw });
    else window.localStorage.setItem(KEY, raw);
  } catch {
    /* best-effort : le filet ne doit jamais casser l'app */
  }
}

export async function clearSessionBackup(): Promise<void> {
  try {
    const p = prefs();
    if (p) await p.remove({ key: KEY });
    else window.localStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Synchronise la copie avec la session courante, et RESTAURE si nécessaire.
 * Renvoie `true` si une session a été réinstallée (l'appelant rafraîchit alors
 * l'écran pour que le rendu serveur reparte avec les bons cookies).
 */
export async function syncOrRestoreSession(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const session = data.session;

    if (session?.access_token && session?.refresh_token) {
      await writeBackup({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        at: Date.now(),
      });
      return false;
    }

    // Pas de session visible : est-ce une VRAIE déconnexion, ou des cookies
    // perdus au réveil ? La copie tranche.
    const backup = await readBackup();
    if (!backup) return false;

    const { error } = await supabase.auth.setSession({
      access_token: backup.access_token,
      refresh_token: backup.refresh_token,
    });
    if (error) {
      // Jetons réellement invalides (déconnexion volontaire, mot de passe
      // changé, session révoquée) → on nettoie pour ne pas boucler.
      await clearSessionBackup();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
