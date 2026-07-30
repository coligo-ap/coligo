"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Mail, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneField } from "@/components/ui/phone-field";
import { PasswordInput } from "@/components/ui/password-input";
import { ReferralCodeField } from "@/components/customer/referral/referral-code-field";
import {
  StepWizardStyle,
  StepWizardHeader,
  StepWizardNav,
  makeWizardKeyDown,
} from "@/components/shared/step-wizard";
import { cn } from "@/lib/utils";
import {
  customerSignup,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

type StepKey = "identite" | "acces" | "confirm";
const STEPS: StepKey[] = ["identite", "acces", "confirm"];

/**
 * Inscription CLIENT en STEP-BY-STEP (même contrat que les wizards
 * partenaires, components/shared/step-wizard) : UN SEUL <form>, panneaux
 * MONTÉS (l'inactif en `hidden`, jamais key={step}) → la soumission finale
 * poste tout d'un coup à `customerSignup`, zéro changement backend.
 * 3 petites étapes = perception « 30 secondes chrono », façon grandes apps.
 */
export function CustomerSignupWizard({
  next,
  refCode,
}: {
  next: string;
  refCode: string;
}) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(
    customerSignup,
    initialState
  );

  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const active = STEPS[step];

  // État contrôlé UNIQUEMENT pour les gates d'étape (les inputs restent des
  // champs de formulaire normaux, postés en une fois à la fin).
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const stepValid: Record<StepKey, boolean> = {
    identite: fullName.trim().length >= 2 && phone !== null,
    acces: /.+@.+\..+/.test(email.trim()) && password.length >= 8,
    confirm: true,
  };
  const canContinue = stepValid[active];

  const meta: Record<StepKey, { title: string; subtitle: string }> = {
    identite: {
      title: t("stepIdentityTitle"),
      subtitle: t("stepIdentitySub"),
    },
    acces: { title: t("stepAccessTitle"), subtitle: t("stepAccessSub") },
    confirm: { title: t("stepConfirmTitle"), subtitle: t("stepConfirmSub") },
  };
  const stepHint: Record<StepKey, string> = {
    identite: t("stepIdentityHint"),
    acces: t("stepAccessHint"),
    confirm: "",
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    if (stepValid[active]) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <form
      action={formAction}
      onKeyDown={makeWizardKeyDown(isLast, goNext)}
      className="space-y-3"
    >
      <StepWizardStyle />
      <input type="hidden" name="next" value={next} />

      <StepWizardHeader
        title={meta[active].title}
        subtitle={meta[active].subtitle}
        stepLabel={t("wizardStepOf", { n: step + 1, total: STEPS.length })}
        step={step}
        total={STEPS.length}
      />

      {/* ── Étape 1 : identité ── */}
      <div
        className={cn(
          "space-y-3",
          active === "identite" ? "swz-panel" : "hidden"
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor="full_name">{t("fullName")}</Label>
          <div className="relative">
            <User className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="full_name"
              name="full_name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              placeholder={t("fullNamePlaceholder")}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              className="ps-9"
            />
          </div>
        </div>
        {/* Téléphone via LE champ canonique de l'app (PhoneField) — plus de
            <input tel> nu, et plus AUCUNE mention de transmission au
            commerçant (demande produit). */}
        <PhoneField required disabled={pending} onValueChange={setPhone} />
      </div>

      {/* ── Étape 2 : accès ── */}
      <div
        className={cn("space-y-3", active === "acces" ? "swz-panel" : "hidden")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <div className="relative">
            <Mail className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="vous@exemple.dz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className="ps-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
          <p className="text-subtle text-xs">{t("passwordHint")}</p>
        </div>
      </div>

      {/* ── Étape 3 : parrainage (optionnel) + consentement + envoi ── */}
      <div
        className={cn(
          "space-y-3",
          active === "confirm" ? "swz-panel" : "hidden"
        )}
      >
        <ReferralCodeField initialCode={refCode} disabled={pending} />
        <p className="text-subtle pt-1 text-center text-xs">
          {t.rich("signupConsent", {
            cgu: (chunks) => (
              <Link
                href="/cgu"
                className="text-primary-700 font-medium hover:underline"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href="/confidentialite"
                className="text-primary-700 font-medium hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>

      {state.error && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="border-success-200 bg-success-50 text-success-800 rounded-[10px] border px-3 py-2.5 text-sm">
          {state.success}
        </div>
      )}

      <StepWizardNav
        step={step}
        isLast={isLast}
        canContinue={canContinue}
        pending={pending}
        onBack={goBack}
        onNext={goNext}
        labels={{ back: t("wizardBack"), next: t("wizardNext") }}
        hint={stepHint[active]}
        submitContent={
          pending ? (
            t("creating")
          ) : (
            <>
              {t("createMyAccount")}{" "}
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            </>
          )
        }
      />
    </form>
  );
}
