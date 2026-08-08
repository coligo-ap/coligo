"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
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
        className="text-caption mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold"
        style={{ background: "var(--violet-soft)", color: BRAND_VIOLET }}
      >
        <Send className="size-3" />
        {tr("Dossier transmis", "أُرسل الملف")}
      </span>
      <h1
        className="text-display-sm leading-tight font-extrabold text-[var(--ink)]"
        style={{ fontFamily: SORA }}
      >
        {isAr ? (
          <>
            طلب تسجيلك
            <br />
            تم إرساله بنجاح.
          </>
        ) : (
          <>
            Votre demande d&apos;inscription
            <br />a bien été transmise.
          </>
        )}
      </h1>
      <p className="text-body-sm mt-2.5 max-w-[320px] leading-relaxed text-[var(--muted)]">
        {tr(
          "L'équipe Coligo procède actuellement à la vérification de votre identité et de vos documents. Vous recevrez une notification dès que votre compte sera validé.",
          "يقوم فريق كوليغو حاليًا بالتحقق من هويتك ووثائقك. ستصلك رسالة إشعار فور المصادقة على حسابك."
        )}
      </p>
      <p className="text-label-lg mt-3 font-semibold text-[var(--ink)]">
        {tr(
          "Merci pour votre confiance et votre patience.",
          "شكرًا على ثقتك وصبرك."
        )}
      </p>
    </div>
  );
}
