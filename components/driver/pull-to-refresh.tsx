"use client";

import {
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowDown } from "lucide-react";

/**
 * Pull-to-refresh : quand on est tout en haut de la page et qu'on glisse vers
 * le bas, on actualise la page courante (`router.refresh()`). Filet de secours
 * pour les cas où une page semble « bloquée » après navigation via le drawer.
 *
 * Le bouton d'actualisation du header fait la même chose au clic.
 */
const THRESHOLD = 64; // px de tirage déclenchant l'actualisation.

export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: ReactTouchEvent) => {
    // On n'arme le geste que si la page est tout en haut.
    startY.current =
      window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    if (startY.current == null) return;
    const d = e.touches[0].clientY - startY.current;
    if (d > 0) setPull(Math.min(96, d * 0.5));
    else setPull(0);
  };
  const onTouchEnd = () => {
    if (startY.current == null) return;
    startY.current = null;
    if (pull >= THRESHOLD) {
      setRefreshing(true);
      setPull(THRESHOLD);
      router.refresh();
      // Laisse le spinner visible un court instant (le refresh serveur est
      // souvent quasi-instantané), puis on relâche.
      setTimeout(() => {
        setRefreshing(false);
        setPull(0);
      }, 900);
    } else {
      setPull(0);
    }
  };

  const armed = pull >= THRESHOLD;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Indicateur de tirage. */}
      <div
        className="pointer-events-none flex items-center justify-center overflow-hidden text-[#5c5ce0]"
        style={{
          height: pull,
          transition: startY.current == null ? "height .2s ease" : "none",
        }}
      >
        {refreshing ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <ArrowDown
            className={
              "size-5 transition-transform " + (armed ? "rotate-180" : "")
            }
          />
        )}
      </div>
      {children}
    </div>
  );
}
