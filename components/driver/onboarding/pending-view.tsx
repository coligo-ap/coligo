"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, LifeBuoy, ShieldQuestion } from "lucide-react";
import { BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { StepsTracker } from "@/components/driver/onboarding/steps-tracker";
import { SubmittedAnimation } from "@/components/driver/onboarding/submitted-animation";

/**
 * ÉTAPE 4 — écran de suivi, seul écran accessible pendant la vérification.
 *
 * Il se re-synchronise à la reprise au premier plan et toutes les 60 s : dès
 * que l'équipe Coligo valide le compte, le rendu serveur redirige de lui-même
 * vers l'écran de félicitations (la page est gardée par `requireDriverStage`),
 * sans que le livreur ait à quitter puis rouvrir l'application.
 */
export function DriverPendingView({
  justSubmitted,
  submittedAt,
}: {
  justSubmitted: boolean;
  submittedAt: string | null;
}) {
  const router = useRouter();
  const [showAnimation, setShowAnimation] = useState(justSubmitted);

  // Retire `?envoye=1` sans re-render serveur : rafraîchir la page ne doit pas
  // rejouer l'animation.
  useEffect(() => {
    if (!justSubmitted) return;
    window.history.replaceState(null, "", "/driver/inscription/attente");
  }, [justSubmitted]);

  const resync = useCallback(() => router.refresh(), [router]);
  useResumeResync(resync);
  useEffect(() => {
    const id = setInterval(resync, 60_000);
    return () => clearInterval(id);
  }, [resync]);

  const submittedLabel = submittedAt
    ? new Date(submittedAt).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
      })
    : "À l'instant";

  return (
    <>
      {showAnimation && (
        <SubmittedAnimation onDone={() => setShowAnimation(false)} />
      )}

      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <StepsTracker
          steps={[
            {
              title: "Compte créé",
              sub: "Vos identifiants sont actifs",
              state: "done",
            },
            {
              title: "Documents transmis",
              sub: `Envoyés le ${submittedLabel}`,
              state: "done",
            },
            {
              title: "Vérification en cours",
              sub: "Identité, véhicule et documents",
              state: "current",
            },
            {
              title: "Validation par l'équipe Coligo",
              sub: "Décision sous 24 à 48 heures ouvrées",
              state: "todo",
            },
            {
              title: "Compte activé",
              sub: "Vous pourrez livrer et générer des revenus",
              state: "todo",
            },
          ]}
        />
      </div>

      <div className="mt-3 space-y-2">
        <InfoRow
          icon={<Clock className="size-4" />}
          title="Vous n'avez rien à faire"
          text="Gardez les notifications activées : vous serez prévenu dès que votre compte sera vérifié."
        />
        <InfoRow
          icon={<ShieldQuestion className="size-4" />}
          title="Pourquoi cette attente ?"
          text="Chaque dossier est examiné manuellement par l'équipe Coligo. C'est ce qui garantit la sécurité des clients, des commerçants et des livreurs."
        />
        <InfoRow
          icon={<LifeBuoy className="size-4" />}
          title="Une question ?"
          text="Écrivez à support@coligo.app en indiquant votre numéro de téléphone."
        />
      </div>
    </>
  );
}

function InfoRow({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[11px]"
        style={{ background: "var(--violet-soft)", color: BRAND_VIOLET }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <b
          className="block text-[13px] font-bold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          {title}
        </b>
        <small className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--muted)]">
          {text}
        </small>
      </div>
    </div>
  );
}
