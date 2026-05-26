"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
 * Pas de lib externe (nprogress / etc.) — 30 lignes suffisent.
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  // Quand la nav se termine (pathname/searchParams changent), on complète +
  // on cache après 200 ms.
  useEffect(() => {
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
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
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
