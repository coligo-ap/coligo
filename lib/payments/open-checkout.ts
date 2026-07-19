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

/** Ouvre l'URL de paiement. `"inapp"` = l'app reste montée (poller ici). */
export async function openCheckout(url: string): Promise<"inapp" | "redirect"> {
  if (isNativeApp()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return "inapp";
  }
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
