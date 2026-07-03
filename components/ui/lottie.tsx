"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Lecteur Lottie LÉGER pour micro-illustrations animées (bandeau de suivi,
 * états vides…).
 *
 *  - `lottie_light` (rendu SVG seul, ~45 KB gzip) importé DYNAMIQUEMENT au
 *    premier montage → 0 KB dans le bundle initial des pages.
 *  - Fichiers `.json` LOCAUX (`public/lottie/`, cf. CREDITS.md) : aucun CDN,
 *    offline-safe APK ; le navigateur les met en cache.
 *  - `fallback` (scène CSS/icônes) affiché tant que l'animation n'est pas
 *    prête, si le chargement échoue, ou si `prefers-reduced-motion` — le
 *    bandeau ne dépend donc JAMAIS de Lottie pour fonctionner.
 */
export function LottieScene({
  src,
  fallback,
  className,
  speed = 1,
}: {
  /** URL locale du .json (ex. `/lottie/preparing.json`). */
  src: string;
  /** Scène de repli (icônes/CSS) — rendue tant que Lottie ne joue pas. */
  fallback?: React.ReactNode;
  /** Classes du conteneur du lecteur (dimensionnement/position). */
  className?: string;
  speed?: number;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "fallback">(
    "loading"
  );

  useEffect(() => {
    let cancelled = false;
    let anim: { destroy: () => void; setSpeed: (s: number) => void } | null =
      null;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setState("fallback");
      return;
    }
    (async () => {
      try {
        const [{ default: lottie }, res] = await Promise.all([
          import("lottie-web/build/player/lottie_light"),
          fetch(src),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as unknown;
        if (cancelled || !boxRef.current) return;
        anim = lottie.loadAnimation({
          container: boxRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: data,
        });
        anim.setSpeed(speed);
        setState("playing");
      } catch {
        if (!cancelled) setState("fallback");
      }
    })();
    return () => {
      cancelled = true;
      try {
        anim?.destroy();
      } catch {
        /* déjà détruit */
      }
    };
  }, [src, speed]);

  if (state === "fallback") return <>{fallback}</>;
  return (
    <>
      {state === "loading" && fallback}
      <span
        ref={boxRef}
        aria-hidden
        className={cn(
          "pointer-events-none [&_svg]:!h-full [&_svg]:!w-full",
          state !== "playing" && "opacity-0",
          className
        )}
      />
    </>
  );
}
