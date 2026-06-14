"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, AlertTriangle } from "lucide-react";

/**
 * Error boundary racine (segments sous `app/`). Intercepte TOUTE exception
 * client — y compris l'échec d'un fetch RSC pendant une navigation SPA quand
 * le réseau tombe (mode avion, 0 data) — pour éviter le message brut Next.js
 * « Application error: a client-side exception has occurred ».
 *
 * Comportement réseau-conscient (Algérie : réseau instable) :
 *  - hors ligne → écran « Pas de connexion » + reconnexion auto via `online`.
 *  - en ligne   → erreur applicative classique avec « Réessayer ».
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // navigator.onLine n'est fiable que pour « offline » (true peut mentir),
    // mais une coupure réseau le passe bien à false → suffisant ici.
    const sync = () => setOffline(!navigator.onLine);
    sync();
    // Quand la connexion revient, on retente automatiquement le rendu.
    const onOnline = () => {
      setOffline(false);
      reset();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", sync);
    };
  }, [reset]);

  useEffect(() => {
    console.error("[RootError]", error);
    // ChunkLoadError (chunks obsolètes après déploiement) : re-render ne sert à
    // rien, le module n'existe plus. En ligne → recharger pour récupérer les
    // chunks à jour, avec garde anti-boucle (12 s).
    const msg = `${error?.name ?? ""}: ${error?.message ?? ""}`;
    const isChunk =
      /ChunkLoadError/i.test(msg) ||
      /Loading (CSS )?chunk [\w-]+ failed/i.test(msg) ||
      /dynamically imported module/i.test(msg);
    if (isChunk && typeof navigator !== "undefined" && navigator.onLine) {
      let last = 0;
      try {
        last =
          parseInt(
            sessionStorage.getItem("coligo_chunk_reload_at") ?? "0",
            10
          ) || 0;
      } catch {
        /* ignoré */
      }
      if (Date.now() - last >= 12_000) {
        try {
          sessionStorage.setItem("coligo_chunk_reload_at", String(Date.now()));
        } catch {
          /* ignoré */
        }
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <main className="bg-surface-2 flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="border-border w-full max-w-sm rounded-[14px] border bg-white p-6 text-center shadow-sm">
        <div
          className={`mx-auto mb-4 flex size-12 items-center justify-center rounded-full ${
            offline
              ? "bg-primary-50 text-primary-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {offline ? (
            <WifiOff className="size-6" />
          ) : (
            <AlertTriangle className="size-6" />
          )}
        </div>

        <h1 className="text-foreground text-xl font-bold">
          {offline ? "Pas de connexion" : "Une erreur est survenue"}
        </h1>
        <p className="text-muted mt-2 text-sm">
          {offline
            ? "Vérifiez votre Wi-Fi ou vos données mobiles. La page se rechargera dès le retour du réseau."
            : "Un problème est survenu pendant le chargement. Vous pouvez réessayer."}
        </p>

        <button
          type="button"
          onClick={() => reset()}
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-medium text-white transition-colors"
        >
          <RefreshCw className="size-4" />
          Réessayer
        </button>
      </div>
    </main>
  );
}
