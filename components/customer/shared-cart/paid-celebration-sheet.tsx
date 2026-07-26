"use client";

import type { ReactNode } from "react";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";

// =============================================================================
// PaidCelebrationSheet — feuille de célébration « paiement confirmé » PARTAGÉE
// (room /p/[token] + page publique /payer) : un seul échafaudage (overlay +
// animation + célébration + titre/description) au lieu de deux modales qui
// divergeaient. Ferme au tap sur le fond ; la feuille scrolle si le viewport
// est court (paysage) — le bouton de fermeture reste toujours atteignable.
// =============================================================================

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
      <style>{`@keyframes scPaidPop{from{opacity:0;transform:translateY(28px) scale(.95)}to{opacity:1;transform:none}}`}</style>
      <div
        className="bg-surface max-h-[calc(100dvh-1rem)] w-full max-w-[420px] [animation:scPaidPop_.4s_cubic-bezier(.18,.9,.28,1.15)_both] overflow-y-auto rounded-t-[26px] px-5 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[26px] sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-border mx-auto mb-4 h-[5px] w-9 rounded-full sm:hidden" />
        <ColigoCelebration variant="verified" />
        <h3 className="text-foreground mt-2 text-center text-[18px] font-extrabold tracking-[-0.4px]">
          {title}
        </h3>
        <p className="text-muted mx-auto mt-1.5 max-w-[320px] text-center text-[13px] font-semibold">
          {desc}
        </p>
        {children}
      </div>
    </div>
  );
}
