"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";

/**
 * Bouton « Réessayer » de la page `/offline` (repli du service worker sur une
 * navigation hors ligne). Même RÈGLE que `ConnectionGuard` : on ne recharge
 * JAMAIS dans le vide — on SONDE d'abord (l'événement `online` ment : Wi-Fi
 * capté ≠ Internet). On ne recharge que si un paquet revient vraiment. Reconnexion
 * automatique au VRAI retour du réseau (l'utilisateur n'a rien à faire).
 *
 * `window.location.reload()` recharge l'URL RÉELLE demandée (le SW a servi
 * `/offline` sans changer la barre d'adresse) → on repart sur la bonne page.
 */
export function OfflineRetry() {
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const probe = useCallback(async () => {
    try {
      await fetch(`/favicon-32.png?_=${Date.now()}`, {
        method: "HEAD",
        cache: "no-store",
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const tryReconnect = useCallback(async () => {
    setChecking(true);
    setHint(null);
    const ok = navigator.onLine !== false && (await probe());
    if (ok) {
      window.location.reload();
      return;
    }
    setChecking(false);
    setHint("Toujours hors ligne…");
    window.setTimeout(() => setHint(null), 2500);
  }, [probe]);

  useEffect(() => {
    const onOnline = () => void tryReconnect();
    window.addEventListener("online", onOnline);
    // Filet : `online` ment parfois → on sonde doucement et on ne repart que si
    // la sonde aboutit. Inutile de sonder en mode Avion (OS formel).
    const id = window.setInterval(() => {
      if (navigator.onLine === false) return;
      void tryReconnect();
    }, 6000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(id);
    };
  }, [tryReconnect]);

  return (
    <>
      <button
        type="button"
        onClick={tryReconnect}
        disabled={checking}
        className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[12px] px-6 text-sm font-semibold text-white transition-colors active:scale-95 disabled:opacity-60"
      >
        {checking ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Réessayer
      </button>
      <p className="text-muted mt-3 text-xs">
        {hint ?? "On réessaie tout seul dès le retour du réseau…"}
      </p>
    </>
  );
}
