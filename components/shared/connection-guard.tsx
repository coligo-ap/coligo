"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff, RotateCw, Loader2 } from "lucide-react";
import { setNetworkOffline } from "@/lib/connectivity/network-store";

/**
 * Garde de connexion PARTAGÉ — monté une fois par espace (client, livreur,
 * chauffeur). Objectif produit : ne JAMAIS laisser l'utilisateur croire qu'il
 * est connecté quand il ne l'est pas (mode Avion, Wi-Fi sans Internet, coupure).
 *
 * RÈGLE CENTRALE — on ne change JAMAIS d'état sans réponse réseau confirmée.
 *  - `navigator.onLine === false` (mode Avion) → hors ligne IMMÉDIAT (l'OS est
 *    formel : il n'y a pas d'interface réseau).
 *  - Passage « en ligne » : on ne fait JAMAIS confiance à l'événement `online`
 *    seul (il ment : Wi-Fi capté ≠ Internet joignable). On SONDE (HEAD
 *    same-origin) et on ne repasse en ligne QUE si le paquet revient.
 *  - Sonde aussi au montage : si `navigator.onLine` ment (« online » sans
 *    Internet, fréquent sur certaines WebView Android), on le rattrape.
 *
 * Superposition : `z-[300]`, au-dessus de tout (cartes plein écran z-[80..95],
 * bandeaux z-[120..140], dialogues z-[200]) — jamais caché derrière un composant.
 *
 * Au retour RÉEL du réseau : `router.refresh()` recharge les données périmées
 * sans démonter la coque (pas de flash, pas de perte d'état).
 */
export function ConnectionGuard() {
  const router = useRouter();
  // `null` = pas encore déterminé (avant 1re évaluation) → on ne montre rien.
  const [offline, setOffline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const offlineRef = useRef<boolean | null>(null);
  const probingRef = useRef(false);

  /** Sonde le vrai réseau : une réponse (même 404) prouve la connectivité. */
  const probe = useCallback(async (): Promise<boolean> => {
    if (probingRef.current) return false;
    probingRef.current = true;
    try {
      await fetch(`${window.location.origin}/favicon.ico?_=${Date.now()}`, {
        method: "HEAD",
        cache: "no-store",
      });
      return true; // le serveur a répondu → réseau up
    } catch {
      return false; // échec réseau → toujours coupé
    } finally {
      probingRef.current = false;
    }
  }, []);

  /** Applique un état confirmé. Recharge SEULEMENT sur transition hors→en ligne. */
  const apply = useCallback(
    (isOffline: boolean) => {
      const was = offlineRef.current;
      offlineRef.current = isOffline;
      setOffline(isOffline);
      // Partage l'état confirmé : les composants qui ne peuvent pas fonctionner
      // hors ligne (ex. bouton « Passer en ligne ») s'y abonnent.
      setNetworkOffline(isOffline);
      if (was === true && isOffline === false) {
        setHint(null);
        router.refresh();
      }
    },
    [router]
  );

  /**
   * Détermine l'état SANS jamais flipper à l'aveugle :
   *  - OS dit hors ligne → hors ligne (certain) ;
   *  - sinon → sonde, et n'affirme « en ligne » que si le paquet revient.
   */
  const evaluate = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      apply(true);
      return;
    }
    const ok = await probe();
    apply(!ok);
  }, [apply, probe]);

  useEffect(() => {
    void evaluate();

    // Coupure : l'OS est fiable pour DÉTECTER l'absence → hors ligne immédiat.
    const onOffline = () => apply(true);
    // Retour supposé : NE PAS croire l'événement — on re-sonde (evaluate).
    const onOnline = () => void evaluate();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [apply, evaluate]);

  // Tant qu'on est hors ligne : sonde périodique pour repartir dès le VRAI
  // retour réseau. On ne sonde pas si l'OS confirme la coupure (Avion) : inutile.
  useEffect(() => {
    if (offline !== true) return;
    const id = window.setInterval(() => {
      if (navigator.onLine === false) return; // Avion : rien à sonder
      void evaluate();
    }, 6000);
    return () => window.clearInterval(id);
  }, [offline, evaluate]);

  const onRetry = useCallback(async () => {
    setChecking(true);
    setHint(null);
    const ok = navigator.onLine !== false && (await probe());
    setChecking(false);
    if (ok) {
      apply(false);
    } else {
      setHint("Toujours hors ligne…");
      window.setTimeout(() => setHint(null), 2500);
    }
  }, [apply, probe]);

  if (offline !== true) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[300] px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2"
    >
      <div className="rounded-card-lg mx-auto flex max-w-md items-center gap-3 bg-[#17151f]/95 px-3.5 py-2.5 text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
        <WifiOff className="text-accent-500 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body leading-tight font-semibold">
            Connexion instable ou coupée
          </p>
          <p className="text-label mt-0.5 leading-snug text-white/65">
            {hint ?? "Nouvelle tentative dès le retour du réseau…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={checking}
          className="rounded-control text-body-sm inline-flex shrink-0 items-center gap-1.5 bg-white px-3 py-1.5 font-bold text-[#17151f] transition-transform active:scale-95 disabled:opacity-60"
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="size-4" aria-hidden />
          )}
          Réessayer
        </button>
      </div>
    </div>
  );
}
