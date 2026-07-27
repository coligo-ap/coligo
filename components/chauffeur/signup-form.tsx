"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneField } from "@/components/ui/phone-field";
import {
  StepWizardHeader,
  StepWizardNav,
  StepWizardStyle,
  makeWizardKeyDown,
} from "@/components/shared/step-wizard";
import { cn } from "@/lib/utils";
import {
  chauffeurLogout,
  chauffeurSignup,
  type ChauffeurAuthState,
} from "@/app/(chauffeur)/actions";

const initial: ChauffeurAuthState = {};

const GAMMES = [
  ["classic", "Classic"],
  ["confort", "Confort"],
  ["moto", "Moto"],
] as const;

type StepKey = "identity" | "contact" | "vehicle" | "access";
const STEPS: StepKey[] = ["identity", "contact", "vehicle", "access"];

/**
 * Inscription chauffeur ÉTAPE PAR ÉTAPE (style Bolt) : identité → contact →
 * véhicule → mot de passe. UN SEUL <form>, panneaux tous MONTÉS (l'inactif en
 * `hidden`) — la soumission finale poste les mêmes champs qu'avant à
 * `chauffeurSignup` (→ documents ensuite), zéro changement backend.
 *
 * `connectedPhone` : si un chauffeur est déjà connecté sur l'appareil, bandeau
 * de déconnexion (impossible d'inscrire un nouveau chauffeur sans se
 * déconnecter d'abord — sinon l'inscription échoue silencieusement).
 */
export function ChauffeurSignupForm({
  connectedPhone = null,
}: {
  connectedPhone?: string | null;
}) {
  const [state, action, pending] = useActionState(chauffeurSignup, initial);
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const active = STEPS[step];

  // Saisie contrôlée UNIQUEMENT pour le gate de chaque étape.
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [gamme, setGamme] = useState<"classic" | "confort" | "moto">("classic");

  const META: Record<StepKey, { title: string; subtitle: string }> = {
    identity: {
      title: tr("Vous", "أنت"),
      subtitle: tr(
        "Votre identité, comme sur vos papiers.",
        "هويتك كما في وثائقك."
      ),
    },
    contact: {
      title: tr("Contact", "التواصل"),
      subtitle: tr(
        "Le téléphone sera votre identifiant de connexion.",
        "الهاتف هو معرّف تسجيل دخولك."
      ),
    },
    vehicle: {
      title: tr("Votre véhicule", "مركبتك"),
      subtitle: tr("Choisissez la gamme proposée aux clients.", "اختر الفئة."),
    },
    access: {
      title: tr("Mot de passe", "كلمة المرور"),
      subtitle: tr("Pour sécuriser votre compte.", "لتأمين حسابك."),
    },
  };

  // Mêmes minimums que le zod serveur (noms ≥ 2, ville ≥ 2, mdp ≥ 6).
  const stepValid: Record<StepKey, boolean> = {
    identity:
      lastName.trim().length >= 2 &&
      firstName.trim().length >= 2 &&
      birthDate.length >= 8,
    contact: phone !== null && city.trim().length >= 2,
    vehicle: true,
    access: password.length >= 6,
  };
  const canContinue = stepValid[active];

  const stepHint: Record<StepKey, string> = {
    identity: tr(
      "Nom, prénom et date de naissance requis.",
      "اللقب والاسم وتاريخ الميلاد مطلوبة."
    ),
    contact: tr(
      "Téléphone valide et wilaya/ville requis.",
      "هاتف صالح وولاية/مدينة مطلوبان."
    ),
    vehicle: "",
    access: tr(
      "Mot de passe de 6 caractères minimum.",
      "كلمة سر من 6 أحرف على الأقل."
    ),
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    if (canContinue) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <>
      {connectedPhone && (
        <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm text-amber-900">
            {tr("Vous êtes déjà connecté en tant que", "أنت متصل بالفعل باسم")}{" "}
            <b dir="ltr">{connectedPhone}</b>
            {tr(
              ". Pour inscrire un autre chauffeur, déconnectez-vous d'abord.",
              ". لتسجيل سائق آخر، سجّل الخروج أولًا."
            )}
          </p>
          <form
            action={async () => {
              await chauffeurLogout();
            }}
          >
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-full"
            >
              <LogOut className="size-4" />
              {tr("Se déconnecter", "تسجيل الخروج")}
            </Button>
          </form>
        </div>
      )}

      <form
        action={action}
        onKeyDown={makeWizardKeyDown(isLast, goNext)}
        className="space-y-3"
      >
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
              <Label htmlFor="last_name">
                {tr("Nom", "اللقب")} <span className="text-rose-600">*</span>
              </Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="first_name">
                {tr("Prénom", "الاسم")} <span className="text-rose-600">*</span>
              </Label>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birth_date">
              {tr("Date de naissance", "تاريخ الميلاد")}{" "}
              <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="birth_date"
              name="birth_date"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              disabled={pending}
            />
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
            required
            disabled={pending}
            onValueChange={(canonical) => setPhone(canonical)}
            hint={tr("Ton identifiant de connexion.", "معرّف تسجيل دخولك.")}
          />

          <div className="space-y-1.5">
            <Label htmlFor="city">
              {tr("Wilaya / Ville", "الولاية / المدينة")}{" "}
              <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="city"
              name="city"
              type="text"
              placeholder={tr("Alger, Oran…", "الجزائر، وهران…")}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              disabled={pending}
            />
          </div>
        </div>

        {/* ÉTAPE — Véhicule (gamme, boutons segmentés) */}
        <div
          className={cn(
            "space-y-1.5",
            active === "vehicle" ? "swz-panel" : "hidden"
          )}
        >
          <Label>
            {tr("Votre véhicule (gamme)", "مركبتك (الفئة)")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <input type="hidden" name="gamme" value={gamme} />
          <div className="grid grid-cols-3 gap-2">
            {GAMMES.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setGamme(k)}
                disabled={pending}
                className={
                  gamme === k
                    ? "border-primary-600 bg-primary-50 text-primary-700 min-h-[44px] rounded-[10px] border px-2 text-sm font-semibold"
                    : "border-border text-foreground hover:bg-surface-2 min-h-[44px] rounded-[10px] border px-2 text-sm"
                }
              >
                {k === "moto" ? tr("Moto", "دراجة نارية") : label}
              </button>
            ))}
          </div>
        </div>

        {/* ÉTAPE — Mot de passe */}
        <div
          className={cn(
            "space-y-1.5",
            active === "access" ? "swz-panel" : "hidden"
          )}
        >
          <Label htmlFor="password">
            {tr("Mot de passe", "كلمة المرور")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={pending}
          />
        </div>

        {state.error && (
          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
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
          hint={stepHint[active] || null}
          submitDisabled={!!connectedPhone}
          submitContent={
            pending ? (
              tr("Création…", "جارٍ الإنشاء…")
            ) : (
              <>
                {tr("Continuer · mes documents", "متابعة · وثائقي")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </>
            )
          }
        />

        <p className="text-subtle text-center text-xs">
          {tr(
            "En créant un compte, vous acceptez les",
            "بإنشائك حسابًا، فأنت توافق على"
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
    </>
  );
}
