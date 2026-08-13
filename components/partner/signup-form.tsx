"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRight, FileText, Store, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneField } from "@/components/ui/phone-field";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
import { TurnstileField } from "@/components/shared/turnstile-field";
import {
  StepWizardHeader,
  StepWizardNav,
  StepWizardStyle,
  makeWizardKeyDown,
} from "@/components/shared/step-wizard";
import { cn } from "@/lib/utils";
import { partnerSignup, type PartnerAuthState } from "@/app/(partner)/actions";

const initial: PartnerAuthState = {};

type StepKey = "point" | "dossier" | "location" | "access";
const STEPS: StepKey[] = ["point", "dossier", "location", "access"];

/**
 * Auto-inscription Agent Coligo Pay ÉTAPE PAR ÉTAPE (style Bolt Food) : point →
 * dossier → emplacement → accès. UN SEUL <form>, panneaux tous MONTÉS (l'inactif
 * en `hidden`) — la soumission finale poste les mêmes champs qu'avant à
 * `partnerSignup`, zéro changement backend. Les PIÈCES (RC, identité) restent
 * déposées juste après, depuis l'espace agent (« Mon dossier »).
 */
export function PartnerSignupForm() {
  // Bilingue FR/AR comme les autres portails partenaires.
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const META: Record<StepKey, { title: string; subtitle: string }> = {
    point: {
      title: tr("Votre point de recharge", "نقطة التعبئة الخاصة بك"),
      subtitle: tr("Son nom, et celui du gérant.", "اسمها واسم المسيّر."),
    },
    dossier: {
      title: tr("Votre dossier", "ملفك"),
      subtitle: tr(
        "Le registre de commerce du point.",
        "السجل التجاري للنقطة."
      ),
    },
    location: {
      title: tr("Emplacement", "الموقع"),
      subtitle: tr(
        "Placez le point sur la carte — il apparaîtra aux clients.",
        "ضع النقطة على الخريطة — ستظهر للزبائن."
      ),
    },
    access: {
      title: tr("Vos accès", "معلومات دخولك"),
      subtitle: tr(
        "Le téléphone sera votre identifiant de connexion.",
        "الهاتف هو معرّف تسجيل دخولك."
      ),
    },
  };
  const [state, action, pending] = useActionState(partnerSignup, initial);

  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const active = STEPS[step];

  // Saisie contrôlée UNIQUEMENT pour le gate de chaque étape.
  const [displayName, setDisplayName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [registre, setRegistre] = useState("");
  const [locationValid, setLocationValid] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  // Mêmes minimums que le zod serveur (noms/RC ≥ 2, mot de passe ≥ 6).
  const stepValid: Record<StepKey, boolean> = {
    point: displayName.trim().length >= 2 && ownerName.trim().length >= 2,
    dossier: registre.trim().length >= 2,
    location: locationValid,
    access: phone !== null && password.length >= 6,
  };
  const canContinue = stepValid[active];

  const stepHint: Record<StepKey, string> = {
    point: tr(
      "Indiquez le nom du point et celui du gérant.",
      "أدخل اسم النقطة واسم المسيّر."
    ),
    dossier: tr(
      "Le n° de registre de commerce est requis.",
      "رقم السجل التجاري مطلوب."
    ),
    location: tr(
      "Placez puis confirmez la position exacte sur la carte.",
      "ضع الموقع الدقيق على الخريطة ثم أكّده."
    ),
    access: tr(
      "Téléphone valide et mot de passe de 6 caractères minimum.",
      "هاتف صالح وكلمة سر من 6 أحرف على الأقل."
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
      <StepWizardStyle />
      {/* Anti-bot : honeypot + captcha Turnstile invisible (dormant sans clé). */}
      <TurnstileField />
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

      {/* ÉTAPE — Le point (panneaux tous montés, l'inactif masqué) */}
      <div
        className={cn("space-y-3", active === "point" ? "swz-panel" : "hidden")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="displayName">
            {tr("Nom du point de recharge", "اسم نقطة التعبئة")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <Store className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="displayName"
              name="displayName"
              type="text"
              placeholder="Alimentation El Baraka"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ownerName">
            {tr("Nom & prénom du gérant", "لقب واسم المسيّر")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <UserRound className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="ownerName"
              name="ownerName"
              type="text"
              placeholder="Karim Benali"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* ÉTAPE — Dossier */}
      <div
        className={cn(
          "space-y-3",
          active === "dossier" ? "swz-panel" : "hidden"
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor="registreCommerce">
            {tr("N° de registre de commerce", "رقم السجل التجاري")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <FileText className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="registreCommerce"
              name="registreCommerce"
              type="text"
              placeholder="RC 16/00-1234567 B 24"
              value={registre}
              onChange={(e) => setRegistre(e.target.value)}
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hours">
            {tr("Horaires (optionnel)", "أوقات العمل (اختياري)")}
          </Label>
          <Input
            id="hours"
            name="hours"
            type="text"
            placeholder={tr(
              "08h – 20h, tous les jours",
              "08:00 – 20:00، كل الأيام"
            )}
            disabled={pending}
          />
        </div>

        <p className="text-subtle text-xs">
          {tr(
            "Les pièces (registre, identité) se déposent juste après, depuis votre espace agent.",
            "الوثائق (السجل، الهوية) تُرفع مباشرة بعد ذلك من فضاء الوكيل."
          )}
        </p>
      </div>

      {/* ÉTAPE — Emplacement (position actuelle par défaut) */}
      <div className={active === "location" ? "swz-panel" : "hidden"}>
        <ShopLocationPicker
          names={{
            wilaya: "wilaya",
            commune: "commune",
            address: "address",
            lat: "lat",
            lng: "lng",
          }}
          initial={{ wilayaCode: "16" }}
          disabled={pending}
          requireConfirm
          gpsAutofill
          onValidityChange={setLocationValid}
        />
      </div>

      {/* ÉTAPE — Accès */}
      <div
        className={cn(
          "space-y-3",
          active === "access" ? "swz-panel" : "hidden"
        )}
      >
        <PhoneField
          required
          disabled={pending}
          onValueChange={(canonical) => setPhone(canonical)}
          hint={tr("Votre identifiant de connexion.", "معرّف تسجيل دخولك.")}
        />

        <div className="space-y-1.5">
          <Label htmlFor="password">
            {tr("Mot de passe", "كلمة المرور")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={6}
            placeholder={tr("Au moins 6 caractères", "6 أحرف على الأقل")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={pending}
          />
        </div>
      </div>

      {state.error && (
        <div className="rounded-control border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {state.error}
        </div>
      )}

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
          pending ? (
            tr("Envoi de la demande…", "جارٍ إرسال الطلب…")
          ) : (
            <>
              {tr("Envoyer ma demande", "إرسال طلبي")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </>
          )
        }
      />

      <p className="text-subtle text-center text-xs">
        {tr(
          "En envoyant votre demande, vous acceptez les",
          "بإرسال طلبك، فأنت توافق على"
        )}{" "}
        <Link
          href="/cgu"
          className="text-primary-700 font-medium hover:underline"
        >
          {tr("Conditions générales", "الشروط العامة")}
        </Link>{" "}
        {tr("et la", "و")}{" "}
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
