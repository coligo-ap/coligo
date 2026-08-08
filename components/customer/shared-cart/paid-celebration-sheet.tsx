"use client";

import type { ReactNode } from "react";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";

// =============================================================================
// PaidCelebrationSheet — feuille de célébration « paiement confirmé » PARTAGÉE
// (room /p/[token] + page publique /payer) : un seul échafaudage (overlay +
// animation + célébration + titre/description) au lieu de deux modales qui
// divergeaient. Ferme au tap sur le fond ; la feuille scrolle si le viewport
// est court (paysage) — le bouton de fermeture reste toujours atteignable.
// Célébration alignée sur la Roue Coligo : confettis (déterministes) +
// titre « boom » — prefers-reduced-motion coupe tout.
// =============================================================================

/** Confettis (gauche %, délai s, durée s, couleur, rotation) — précalculés. */
const SC_CONFETTI = [
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

export function PaidCelebrationSheet({
  title,
  desc,
  onClose,
  children,
}: {
  title: string;
  desc: string;
  onClose: () => void;
  /** Contenu sous la description : détails révélés, boutons d'action… */
  children?: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] flex items-end justify-center bg-[rgba(11,11,15,0.5)] backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <style>{`
@keyframes scPaidPop{from{opacity:0;transform:translateY(28px) scale(.95)}to{opacity:1;transform:none}}
@keyframes scConf{0%{transform:translateY(-16px) rotate(0deg);opacity:1}100%{transform:translateY(240px) rotate(560deg);opacity:0}}
@keyframes scBoom{0%{transform:scale(.4);opacity:0}55%{transform:scale(1.22)}75%{transform:scale(.95)}100%{transform:scale(1);opacity:1}}
.sc-conf{animation:scConf var(--d,1.7s) ease-in var(--w,0s) forwards}
.sc-boom{animation:scBoom .6s cubic-bezier(.2,1.4,.35,1)}
@media (prefers-reduced-motion:reduce){.sc-conf,.sc-boom{animation:none}}
`}</style>
      <div
        className="bg-surface rounded-t-panel-lg sm:rounded-panel-lg relative max-h-[calc(100dvh-1rem)] w-full max-w-[420px] [animation:scPaidPop_.4s_cubic-bezier(.18,.9,.28,1.15)_both] overflow-y-auto px-5 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pluie de confettis (même langage que la victoire de la Roue). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden"
        >
          {SC_CONFETTI.map(([l, w, d, c, r], i) => (
            <span
              key={i}
              className="sc-conf absolute top-0 h-[10px] w-[7px] rounded-[2px]"
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
        <div className="bg-border mx-auto mb-4 h-[5px] w-9 rounded-full sm:hidden" />
        <ColigoCelebration variant="verified" />
        <h3 className="sc-boom text-foreground text-heading-sm mt-2 text-center font-extrabold tracking-[-0.4px]">
          {title}
        </h3>
        <p className="text-muted text-body-sm mx-auto mt-1.5 max-w-[320px] text-center font-semibold">
          {desc}
        </p>
        {children}
      </div>
    </div>
  );
}
