"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";

/**
 * ÉTAPE 3 — confirmation animée juste après l'envoi du dossier.
 *
 * Superposition plein écran jouée une seule fois (à l'arrivée depuis le
 * formulaire, `?envoye=1`), puis fondu de sortie qui laisse apparaître l'écran
 * de suivi. Le message reste lisible quoi qu'il arrive : l'illustration est du
 * CSS/SVG de marque, figée sur son état final si l'utilisateur a réduit les
 * animations.
 */
export function SubmittedAnimation({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2600);
    const t2 = setTimeout(onDone, 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div
      role="status"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-8 text-center transition-opacity duration-400"
      style={{
        background: "var(--d-surface)",
        opacity: leaving ? 0 : 1,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <ColigoCelebration variant="sent" />

      <span
        className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
        style={{ background: "var(--violet-soft)", color: BRAND_VIOLET }}
      >
        <Send className="size-3" />
        Dossier transmis
      </span>
      <h1
        className="text-[21px] leading-tight font-extrabold text-[var(--ink)]"
        style={{ fontFamily: SORA }}
      >
        Votre demande d&apos;inscription
        <br />a bien été transmise.
      </h1>
      <p className="mt-2.5 max-w-[320px] text-[13px] leading-relaxed text-[var(--muted)]">
        L&apos;équipe Coligo procède actuellement à la vérification de votre
        identité et de vos documents. Vous recevrez une notification dès que
        votre compte sera validé.
      </p>
      <p className="mt-3 text-[12.5px] font-semibold text-[var(--ink)]">
        Merci pour votre confiance et votre patience.
      </p>
    </div>
  );
}
