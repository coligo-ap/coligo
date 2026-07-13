"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Délai au-delà duquel une navigation SPA non aboutie est jugée COINCÉE. */
const STUCK_NAV_MS = 5_000;
/** Cadence des retentatives quand la bascule dure ne peut pas partir tout de
 *  suite (page cachée, réseau annoncé hors ligne) — on ne LÂCHE JAMAIS. */
const RETRY_MS = 1_500;

/**
 * Mince barre de progression violette en haut de l'écran, visible UNIQUEMENT
 * pendant qu'une navigation Next.js est en cours (clic sur un <Link>, redirect
 * d'une Server Action, etc.).
 *
 * Mode d'emploi : à monter UNE fois dans le layout racine.
 *
 * Détection : on observe `pathname` + `searchParams`. Avant React 19,
 * `useLinkStatus` n'était dispo qu'à l'intérieur d'un <Link> ; ici on
 * détecte indirectement via les clicks sur <a href> internes : on intercepte
 * le click au capture phase, on montre la barre, et on la cache dès que le
 * pathname change (= navigation terminée).
 *
 * WATCHDOG anti-loader-infini (filet de dernier recours) : comme on connaît
 * déjà le moment où une navigation DÉMARRE (le clic) et où elle SE TERMINE (le
 * pathname change), on arme un minuteur. Si après `STUCK_NAV_MS` le pathname
 * n'a TOUJOURS pas changé alors qu'on est visible + en ligne, c'est que la
 * navigation SPA est coincée (fetch RSC fantôme sur socket mort, file d'actions
 * du App Router bloquée…). On force alors une navigation DURE
 * (`location.assign`) vers la cible : elle ouvre une connexion NEUVE et garantit
 * qu'aucun loader ne reste affiché indéfiniment. Récupération automatique, sans
 * intervention de l'utilisateur (plus besoin de fermer/relancer l'app).
 *
 * Pas de lib externe (nprogress / etc.).
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  // Navigation en attente : cible absolue + minuteur watchdog.
  const pendingNav = useRef<{ href: string; timer: number } | null>(null);

  const clearWatchdog = () => {
    if (pendingNav.current) {
      clearTimeout(pendingNav.current.timer);
      pendingNav.current = null;
    }
  };

  // Quand la nav se termine (pathname/searchParams changent), on complète +
  // on cache après 200 ms, et on désarme le watchdog (navigation aboutie).
  useEffect(() => {
    clearWatchdog();
    if (visible) {
      setProgress(100);
      const t = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  // Démarre la barre dès qu'un click sur un <a href> interne est intercepté.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onClick = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // Externe ?
      if (/^(https?:)?\/\//i.test(href)) return;
      // Cmd/Ctrl-click → nouvel onglet, pas de nav SPA.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      // Téléchargement / nouvel onglet explicite → pas une nav SPA.
      if (target.hasAttribute("download") || target.target === "_blank") return;

      // Résout la cible absolue et n'arme le watchdog que si le PATHNAME change
      // vraiment (re-tap de l'onglet courant, lien query/hash seul → ignorés :
      // le pathname ne bougera pas, ce n'est pas un blocage).
      let absHref: string | null = null;
      let changesPath = false;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin) {
          absHref = url.href;
          changesPath = url.pathname !== window.location.pathname;
        }
      } catch {
        absHref = null;
      }

      setVisible(true);
      setProgress(15);
      // Faux progrès qui monte petit à petit jusqu'à 80 % puis attend.
      let p = 15;
      const tick = setInterval(() => {
        p = Math.min(80, p + Math.random() * 12);
        setProgress(p);
      }, 200);
      // On laissera l'effet pathname/searchParams compléter à 100 %.
      const stop = setTimeout(() => clearInterval(tick), 6000);
      // Cleanup auto si on a rien d'autre.
      window.setTimeout(() => {
        clearInterval(tick);
        clearTimeout(stop);
      }, 8000);

      // Arme le watchdog : si le pathname n'a pas changé à temps → nav coincée.
      clearWatchdog();
      if (absHref && changesPath) {
        const targetHref = absHref;
        // À l'échéance : bascule DURE (connexion neuve) vers la cible. Si la
        // bascule ne peut pas partir à cet instant (page cachée, réseau annoncé
        // hors ligne), on RÉESSAIE en boucle au lieu d'abandonner — l'effet
        // pathname/searchParams désarme dès que la navigation aboutit. Bug
        // vécu : l'ancien watchdog vérifiait `navigator.onLine` UNE fois et
        // lâchait l'affaire → au réveil d'arrière-plan (onLine encore faux
        // pendant un instant), plus AUCUN filet, écran gelé pour de bon.
        const fireOrRetry = () => {
          pendingNav.current = null;
          const canGo =
            document.visibilityState === "visible" &&
            (typeof navigator === "undefined" || navigator.onLine !== false);
          if (canGo) {
            window.location.assign(targetHref);
            return;
          }
          const timer = window.setTimeout(fireOrRetry, RETRY_MS);
          pendingNav.current = { href: targetHref, timer };
        };
        const timer = window.setTimeout(fireOrRetry, STUCK_NAV_MS);
        pendingNav.current = { href: targetHref, timer };
      }
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearWatchdog();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className="bg-primary-600 h-full transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
