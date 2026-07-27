"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneField } from "@/components/ui/phone-field";
import {
  StepWizardHeader,
  StepWizardNav,
  StepWizardStyle,
  makeWizardKeyDown,
} from "@/components/shared/step-wizard";
import { cn } from "@/lib/utils";
import { WILAYAS } from "@/lib/dz/wilayas";
import { driverSignup, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

type StepKey = "identity" | "contact" | "access";
const STEPS: StepKey[] = ["identity", "contact", "access"];

/**
 * Inscription livreur ÉTAPE PAR ÉTAPE (style Bolt) : une question à la fois.
 * UN SEUL <form>, panneaux tous MONTÉS (l'inactif en `hidden`) — la soumission
 * finale poste les mêmes champs qu'avant à `driverSignup`, zéro changement
 * backend. Validation par étape alignée sur le zod serveur.
 */
export function DriverSignupForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "";
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, action, pending] = useActionState(driverSignup, initial);

  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const active = STEPS[step];

  // Saisie contrôlée UNIQUEMENT pour le gate de chaque étape.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [wilaya, setWilaya] = useState("");
  const [password, setPassword] = useState("");

  const META: Record<StepKey, { title: string; subtitle: string }> = {
    identity: {
      title: tr("Vous", "أنت"),
      subtitle: tr("Votre prénom et votre nom.", "اسمك ولقبك."),
    },
    contact: {
      title: tr("Contact", "التواصل"),
      subtitle: tr(
        "Le téléphone sera votre identifiant de connexion.",
        "الهاتف هو معرّف تسجيل دخولك."
      ),
    },
    access: {
      title: tr("Zone et accès", "المنطقة والدخول"),
      subtitle: tr("Votre wilaya et un mot de passe.", "ولايتك وكلمة سر."),
    },
  };

  // Mêmes minimums que le zod serveur (first/last ≥ 2, password ≥ 6).
  const stepValid: Record<StepKey, boolean> = {
    identity: firstName.trim().length >= 2 && lastName.trim().length >= 2,
    contact: phone !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
    access: !!wilaya && password.length >= 6,
  };
  const canContinue = stepValid[active];

  const stepHint: Record<StepKey, string> = {
    identity: tr("Indiquez votre prénom et votre nom.", "أدخل اسمك ولقبك."),
    contact: tr(
      "Téléphone valide et email requis.",
      "هاتف صالح وبريد إلكتروني مطلوبان."
    ),
    access: tr(
      "Wilaya + mot de passe (6 caractères min).",
      "الولاية وكلمة سر (6 أحرف على الأقل)."
    ),
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    if (canContinue) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <form
      action={action}
      onKeyDown={makeWizardKeyDown(isLast, goNext)}
      className="space-y-3"
    >
      <input type="hidden" name="next" value={next} />
      <StepWizardStyle />
      <StepWizardHeader
        title={META[active].title}
        subtitle={META[active].subtitle}
        stepLabel={tr(
          `Étape ${step + 1} sur ${STEPS.length}`,
          `الخطوة ${step + 1} من ${STEPS.length}`
        )}
        step={step}
        total={STEPS.length}
      />

      {/* ÉTAPE — Identité (panneaux tous montés, l'inactif masqué) */}
      <div
        className={cn(
          "space-y-3",
          active === "identity" ? "swz-panel" : "hidden"
        )}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">{tr("Prénom", "الاسم")}</Label>
            <Input
              id="first_name"
              name="first_name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">{tr("Nom", "اللقب")}</Label>
            <Input
              id="last_name"
              name="last_name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              disabled={pending}
            />
          </div>
        </div>
      </div>

      {/* ÉTAPE — Contact */}
      <div
        className={cn(
          "space-y-3",
          active === "contact" ? "swz-panel" : "hidden"
        )}
      >
        <PhoneField
          label={tr("Téléphone", "الهاتف")}
          required
          disabled={pending}
          onValueChange={(canonical) => setPhone(canonical)}
          hint={tr("Ton identifiant de connexion.", "معرّف تسجيل الدخول.")}
        />

        <div className="space-y-1.5">
          <Label htmlFor="email">{tr("Email", "البريد الإلكتروني")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="exemple@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={pending}
          />
        </div>
      </div>

      {/* ÉTAPE — Zone et accès */}
      <div
        className={cn(
          "space-y-3",
          active === "access" ? "swz-panel" : "hidden"
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor="wilaya">{tr("Wilaya", "الولاية")}</Label>
          <select
            id="wilaya"
            name="wilaya"
            required
            disabled={pending}
            value={wilaya}
            onChange={(e) => setWilaya(e.target.value)}
            className="h-12 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] outline-none focus:border-[#6c2bd9] disabled:opacity-50"
          >
            <option value="" disabled>
              {tr("Choisis ta wilaya", "اختر ولايتك")}
            </option>
            {WILAYAS.map((w, i) => (
              <option key={w} value={w}>
                {String(i + 1).padStart(2, "0")} · {w}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{tr("Mot de passe", "كلمة المرور")}</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={pending}
          />
        </div>
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}

      <StepWizardNav
        step={step}
        isLast={isLast}
        canContinue={canContinue}
        pending={pending}
        onBack={goBack}
        onNext={goNext}
        labels={{
          back: tr("Retour", "رجوع"),
          next: tr("Continuer", "متابعة"),
        }}
        hint={stepHint[active]}
        submitContent={
          <>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {tr("Créer mon compte", "إنشاء حسابي")}
          </>
        }
      />

      <p className="text-subtle text-center text-xs">
        {tr(
          "En créant un compte, vous acceptez les ",
          "بإنشاء حساب، فإنك توافق على "
        )}
        <Link
          href="/cgu"
          className="text-primary-700 font-medium hover:underline"
        >
          {tr("Conditions générales", "الشروط العامة")}
        </Link>
        {tr(" et la ", " و")}
        <Link
          href="/confidentialite"
          className="text-primary-700 font-medium hover:underline"
        >
          {tr("Politique de confidentialité", "سياسة الخصوصية")}
        </Link>
        .
      </p>
    </form>
  );
}
