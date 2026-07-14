"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
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
    ? new Date(submittedAt).toLocaleDateString(isAr ? "ar-DZ" : "fr-FR", {
        day: "2-digit",
        month: "long",
      })
    : tr("À l'instant", "الآن");

  return (
    <>
      {showAnimation && (
        <SubmittedAnimation onDone={() => setShowAnimation(false)} />
      )}

      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <StepsTracker
          steps={[
            {
              title: tr("Compte créé", "تم إنشاء الحساب"),
              sub: tr("Vos identifiants sont actifs", "بيانات دخولك نشطة"),
              state: "done",
            },
            {
              title: tr("Documents transmis", "أُرسلت الوثائق"),
              sub: isAr
                ? `أُرسلت في ${submittedLabel}`
                : `Envoyés le ${submittedLabel}`,
              state: "done",
            },
            {
              title: tr("Vérification en cours", "التحقّق قيد الإنجاز"),
              sub: tr(
                "Identité, véhicule et documents",
                "الهوية والمركبة والوثائق"
              ),
              state: "current",
            },
            {
              title: tr("Validation par l'équipe Coligo", "مصادقة فريق كوليڨو"),
              sub: tr(
                "Décision sous 24 à 48 heures ouvrées",
                "قرار خلال 24 إلى 48 ساعة عمل"
              ),
              state: "todo",
            },
            {
              title: tr("Compte activé", "تفعيل الحساب"),
              sub: tr(
                "Vous pourrez livrer et générer des revenus",
                "ستتمكن من التوصيل وتحقيق مداخيل"
              ),
              state: "todo",
            },
          ]}
        />
      </div>

      <div className="mt-3 space-y-2">
        <InfoRow
          icon={<Clock className="size-4" />}
          title={tr("Vous n'avez rien à faire", "لا شيء عليك فعله")}
          text={tr(
            "Gardez les notifications activées : vous serez prévenu dès que votre compte sera vérifié.",
            "أبقِ الإشعارات مفعّلة: سيتم إعلامك فور التحقق من حسابك."
          )}
        />
        <InfoRow
          icon={<ShieldQuestion className="size-4" />}
          title={tr("Pourquoi cette attente ?", "لماذا هذا الانتظار؟")}
          text={tr(
            "Chaque dossier est examiné manuellement par l'équipe Coligo. C'est ce qui garantit la sécurité des clients, des commerçants et des livreurs.",
            "يفحص فريق كوليڨو كل ملف يدويًا. هذا ما يضمن أمان الزبائن والتجار والموصّلين."
          )}
        />
        <InfoRow
          icon={<LifeBuoy className="size-4" />}
          title={tr("Une question ?", "لديك سؤال؟")}
          text={tr(
            "Écrivez à support@coligo.app en indiquant votre numéro de téléphone.",
            "راسل support@coligo.app مع ذكر رقم هاتفك."
          )}
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
