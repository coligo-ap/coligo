"use client";

import { useEffect, useState } from "react";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";

// =============================================================================
// Célébration de COMMANDE (même langage que la Roue et le panier partagé) :
// pluie de confettis déterministe + « boom » du titre. Deux usages :
//  - <OrderCelebrationDecor/> : décor EN PLACE (page /checkout/success payée) ;
//  - <OrderPlacedCelebration/> : one-shot sur /commandes/[id]?placed=1 (cash /
//    paiement différé) — retire le param (replaceState, zéro round-trip) et ne
//    rejoue jamais (le param a disparu). prefers-reduced-motion coupe tout.
// =============================================================================

const CONFETTI = [
  [8, 0, 1.6, "#F59E0B", 40],
  [18, 0.22, 1.9, "#FF2D7A", -60],
  [28, 0.1, 1.5, "#8A4DFF", 90],
  [38, 0.4, 2.0, "#14B8A6", -30],
  [48, 0.05, 1.7, "#6C2BD9", 70],
  [58, 0.3, 1.5, "#F59E0B", -80],
  [68, 0.16, 1.9, "#FF2D7A", 50],
  [78, 0.44, 1.6, "#0EA5E9", -45],
  [88, 0.08, 1.8, "#8A4DFF", 30],
  [14, 0.55, 1.6, "#6C2BD9", 45],
  [44, 0.6, 1.8, "#FF2D7A", -35],
  [74, 0.52, 1.5, "#F59E0B", 85],
] as const;

const CSS = `
@keyframes ocConf{0%{transform:translateY(-16px) rotate(0deg);opacity:1}100%{transform:translateY(260px) rotate(560deg);opacity:0}}
@keyframes ocBoom{0%{transform:scale(.4);opacity:0}55%{transform:scale(1.22)}75%{transform:scale(.95)}100%{transform:scale(1);opacity:1}}
.oc-conf{animation:ocConf var(--d,1.7s) ease-in var(--w,0s) forwards}
.oc-boom{animation:ocBoom .6s cubic-bezier(.2,1.4,.35,1)}
@media (prefers-reduced-motion:reduce){.oc-conf,.oc-boom{animation:none}}
`;

function ConfettiRain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden"
    >
      {CONFETTI.map(([l, w, d, c, r], i) => (
        <span
          key={i}
          className="oc-conf absolute top-0 h-[10px] w-[7px] rounded-[2px]"
          style={{
            left: `${l}%`,
            background: c,
            rotate: `${r}deg`,
            ["--w" as string]: `${w}s`,
            ["--d" as string]: `${d}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Décor de fête EN PLACE : à poser dans un conteneur `relative`. */
export function OrderCelebrationDecor({ title }: { title: string }) {
  return (
    <div className="relative">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <ConfettiRain />
      <ColigoCelebration variant="verified" />
      <h1 className="oc-boom text-foreground mt-3 text-2xl font-bold">
        {title}
      </h1>
    </div>
  );
}

/**
 * One-shot sur la page commande (?placed=1) : feuille de célébration après
 * une commande envoyée en paiement au retrait / à la livraison.
 */
export function OrderPlacedCelebration({
  placed,
  title,
  desc,
  closeLabel,
}: {
  placed: boolean;
  title: string;
  desc: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(placed);
  useEffect(() => {
    if (!placed) return;
    // Retire ?placed=1 sans round-trip : un refresh/retour ne rejoue pas.
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("placed");
      window.history.replaceState(null, "", u);
    } catch {
      /* sans gravité */
    }
  }, [placed]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] flex items-end justify-center bg-[rgba(11,11,15,0.5)] backdrop-blur-[2px] sm:items-center"
      onClick={() => setOpen(false)}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div
        className="bg-surface relative w-full max-w-[420px] overflow-hidden rounded-t-[26px] px-5 pt-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] text-center shadow-2xl sm:rounded-[26px] sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <ConfettiRain />
        <ColigoCelebration variant="verified" />
        <h3 className="oc-boom text-foreground mt-2 text-[18px] font-extrabold tracking-[-0.4px]">
          {title}
        </h3>
        <p className="text-muted mx-auto mt-1.5 max-w-[320px] text-[13px] font-semibold">
          {desc}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="bg-primary-600 hover:bg-primary-700 mt-4 w-full rounded-[14px] px-4 py-3.5 text-base font-extrabold text-white transition active:scale-[0.98]"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
