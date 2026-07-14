import { Suspense } from "react";
import { getLocale } from "next-intl/server";
import { DriverSubmitCodeForm } from "@/components/driver/submit-code-form";
import { DriverShell } from "@/components/driver/driver-shell";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { PartnerBackHeader } from "@/components/shared/partner-ui";

export const dynamic = "force-dynamic";

/**
 * « Rejoindre un commerçant » — fonctionnalité OPÉRATIONNELLE, donc réservée
 * aux comptes vérifiés par l'équipe Coligo. Un livreur non connecté est envoyé
 * sur la connexion, un livreur en cours d'inscription sur son étape du parcours
 * (`requireActiveDriver`). Le lien commerçant↔livreur est de toute façon refusé
 * en base pour un compte non vérifié (trigger, mig 0352).
 */
export default async function DriverSubmitCodePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const gate = await requireActiveDriver();
  const { code } = await searchParams;
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <DriverShell driverFirstName={gate.firstName}>
      <PartnerBackHeader
        href="/driver"
        title={tr("Rejoindre un commerçant", "الانضمام إلى تاجر")}
        subtitle={
          code
            ? tr(
                "Vérifie le code pré-rempli et valide pour envoyer ta demande.",
                "تحقّق من الرمز المعبّأ مسبقًا وأكّد لإرسال طلبك."
              )
            : tr(
                "Saisis le code de référence que le commerçant t'a partagé.",
                "أدخل رمز المرجع الذي شاركه معك التاجر."
              )
        }
      />
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <Suspense fallback={null}>
          <DriverSubmitCodeForm />
        </Suspense>
      </div>
    </DriverShell>
  );
}
