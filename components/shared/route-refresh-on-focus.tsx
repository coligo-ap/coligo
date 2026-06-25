"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchissement DOUX en arrière-plan, complément du Router Cache
 * (`experimental.staleTimes`).
 *
 * Quand l'onglet / l'app revient au premier plan après avoir été masqué un
 * certain temps (changement d'app sur APK, retour sur l'onglet…), on
 * re-synchronise les données du Server Component COURANT via `router.refresh()`.
 * C'est un refresh SOUPLE : il re-streame le RSC et réconcilie, SANS démonter la
 * page ni vider l'état des composants client (pas de flash `loading.tsx`, scroll
 * et saisies préservés). On ne recharge donc QUE ce qui a changé côté serveur,
 * de façon asynchrone — exactement le « stale-while-revalidate » souhaité.
 *
 * Garde-fou 1 : on ne rafraîchit que si l'app a été masquée au moins
 * `minHiddenMs` (par défaut 10 s) → pas de refresh inutile sur les micro-bascules.
 *
 * ⚠️ Garde-fou 2 — ANTI-DEADLOCK DE NAVIGATION (bug vécu : loader infini après
 * retour d'arrière-plan). `router.refresh()` lance un fetch RSC NON ABORTABLE.
 * Au retour au premier plan, le socket HTTP gardé en vie (keep-alive) est
 * souvent à MOITIÉ MORT (NAT expiré, réseau basculé wifi↔data) : le navigateur
 * le réutilise et la requête se met en attente SANS jamais résoudre ni échouer.
 * Or `refresh()` et `push()` (clic sur un <Link>) passent par la MÊME file
 * d'actions SÉRIELLE du App Router → la navigation suivante de l'utilisateur est
 * BLOQUÉE derrière ce refresh fantôme = loader infini jusqu'au rechargement.
 * On SONDE donc d'abord la connexion avec un fetch BORNÉ (AbortController) : on
 * ne déclenche le refresh QUE si le socket répond. Sinon on s'abstient — la
 * prochaine navigation rouvrira un socket neuf, et TanStack Query / Realtime /
 * `useResumeResync` couvrent déjà la fraîcheur des écrans « live ». Même esprit
 * que le disjoncteur OSRM : on borne TOUTE requête réseau au réveil.
 */
export function RouteRefreshOnFocus({
  minHiddenMs = 10_000,
}: {
  minHiddenMs?: number;
}) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const probing = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      // Revenu au premier plan.
      const hiddenFor = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (hiddenFor < minHiddenMs || probing.current) return;

      probing.current = true;
      void probeConnectionAlive(3500)
        .then((alive) => {
          // Toujours visible + connexion confirmée vivante → refresh sûr (le
          // socket répond, le fetch RSC ne restera pas fantôme).
          if (alive && document.visibilityState === "visible") {
            router.refresh();
          }
        })
        .finally(() => {
          probing.current = false;
        });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router, minHiddenMs]);

  return null;
}

/**
 * Teste que la connexion réseau répond réellement, de façon BORNÉE (le fetch est
 * abortable au bout de `timeoutMs`, contrairement à `router.refresh()`). On vise
 * `/favicon.ico` (servi statiquement, HORS middleware → pas d'`auth.getUser()`,
 * réponse minuscule). `cache: no-store` + cache-buster forcent un vrai
 * aller-retour réseau → on teste le SOCKET, pas le cache. Échec/timeout =
 * connexion encore froide → on n'arme pas de `router.refresh()` qui se bloquerait.
 */
async function probeConnectionAlive(timeoutMs: number): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`/favicon.ico?_probe=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
