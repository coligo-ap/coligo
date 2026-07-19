"use client";

import { Capacitor } from "@capacitor/core";

// =============================================================================
// Ouverture d'un checkout (Chargily…) SANS quitter l'application.
//
// APK Capacitor : navigateur intégré (@capacitor/browser — Custom Tabs /
// SFSafariViewController) par-dessus l'app, qui RESTE montée : l'écran
// appelant continue de poller la confirmation (webhook) et affiche le
// résultat natif. La page de retour Chargily (onglet intégré, cookies Chrome
// ≠ session app) doit donc être PUBLIQUE et minimale : /paiement/retour.
//
// Web / PWA : redirection classique (returnPath de l'écran appelant, comme
// avant) — le comportement historique ne change pas.
// =============================================================================

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Ouvre l'URL dans le navigateur INTÉGRÉ (Custom Tabs / SFSafariViewController).
 * ROBUSTE : si le plugin n'est pas lié dans ce binaire (ex. build iOS sans le
 * plugin Browser) `Browser.open` rejette — on ne laisse JAMAIS l'utilisateur
 * sans page de paiement : repli redirection classique. Retourne true si
 * l'onglet intégré s'est ouvert (l'app reste montée), false si on a redirigé.
 */
async function openInAppBrowser(url: string): Promise<boolean> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return true;
  } catch {
    // Plugin absent / erreur native → redirection (le paiement passe quand même).
    window.location.href = url;
    return false;
  }
}

/**
 * Ouvre l'URL de paiement pour un flux « REDIRECT-ET-RETOUR » (checkout,
 * recharge portefeuille) :
 *   - natif  → navigateur intégré, l'app RESTE montée (`"inapp"` → poller ici) ;
 *   - web    → redirection classique (`"redirect"`) ; Chargily revient via son
 *     successUrl et le gestionnaire de retour de la page prend le relais.
 */
export async function openCheckout(url: string): Promise<"inapp" | "redirect"> {
  if (isNativeApp()) {
    return (await openInAppBrowser(url)) ? "inapp" : "redirect";
  }
  window.location.href = url;
  return "redirect";
}

/**
 * Ouvre l'URL de paiement pour un flux « RESTER-ET-POLLER » (abonnements,
 * Pass) : l'app RESTE montée DANS LES DEUX cas, l'appelant polle l'activation
 * (webhook) puis met à jour l'écran.
 *   - natif  → navigateur intégré (`"inapp"`) ;
 *   - web    → nouvel onglet (`"newtab"`) — la page courante n'est pas quittée.
 * Repli redirection si le navigateur bloque le nouvel onglet (pop-up).
 */
export async function openCheckoutKeepPage(
  url: string
): Promise<"inapp" | "newtab" | "redirect"> {
  if (isNativeApp()) {
    return (await openInAppBrowser(url)) ? "inapp" : "redirect";
  }
  const win = window.open(url, "_blank", "noopener");
  if (win) return "newtab";
  // Pop-up bloquée → on ne laisse pas l'utilisateur sans page de paiement.
  window.location.href = url;
  return "redirect";
}

/** Referme l'onglet intégré (no-op Android — l'utilisateur revient seul). */
export async function closeCheckout(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* Custom Tabs Android : fermeture programmée non supportée */
  }
}
