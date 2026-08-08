"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  StepWizardHeader,
  StepWizardNav,
  StepWizardStyle,
  makeWizardKeyDown,
} from "@/components/shared/step-wizard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneField } from "@/components/ui/phone-field";
import {
  signup,
  completeSocialSignup,
  type AuthState,
} from "@/app/(merchant)/actions";
import { saveSignupDraft } from "@/app/(auth)/signup/draft-actions";
import { CategoryMultiSelect } from "@/components/merchant/settings/category-multi-select";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  ArrowRight,
  Lock,
  Mail,
  MailCheck,
  Store,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

const initialState: AuthState = {};

type StepKey = "shop" | "types" | "location" | "account";

/**
 * Inscription commerçant ÉTAPE PAR ÉTAPE (style Bolt Food) : une question à la
 * fois au lieu d'un long formulaire. UN SEUL <form> — tous les panneaux restent
 * MONTÉS (l'inactif en `hidden`, jamais de démontage qui perdrait la saisie ou
 * les inputs cachés de CategoryMultiSelect / ShopLocationPicker) ; la soumission
 * finale poste donc exactement les mêmes champs qu'avant aux mêmes actions
 * serveur (`signup` / `completeSocialSignup`) — zéro changement backend.
 *
 * - mode "email"  : 4 étapes (commerce → type → emplacement → compte).
 * - mode "google" : 3 étapes, le compte auth existe déjà (/signup/boutique).
 */
export function ShopSignupWizard({ mode }: { mode: "email" | "google" }) {
  // Bilingue FR/AR (demande : les inscriptions partenaires doivent être
  // traduites comme le reste des portails).
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const STEP_META: Record<StepKey, { title: string; subtitle: string }> = {
    shop: {
      title: tr("Votre commerce", "متجرك"),
      subtitle: tr("Son nom, et celui du responsable.", "اسمه واسم المسؤول."),
    },
    types: {
      title: tr("Type de commerce", "نوع النشاط"),
      subtitle: tr(
        "Le premier choisi est le principal.",
        "الأول الذي تختاره هو الرئيسي."
      ),
    },
    location: {
      title: tr("Emplacement", "الموقع"),
      subtitle: tr(
        "Placez votre boutique sur la carte.",
        "ضع متجرك على الخريطة."
      ),
    },
    account: {
      title: tr("Votre compte", "حسابك"),
      subtitle: tr("Vos identifiants de connexion.", "معلومات تسجيل دخولك."),
    },
  };
  const [state, formAction, pending] = useActionState(
    mode === "email" ? signup : completeSocialSignup,
    initialState
  );

  const steps: StepKey[] =
    mode === "email"
      ? ["shop", "types", "location", "account"]
      : ["shop", "types", "location"];
  const [step, setStep] = useState(0);
  const isLast = step === steps.length - 1;
  const active = steps[step];

  // Saisie contrôlée UNIQUEMENT pour valider chaque étape avant d'avancer —
  // les inputs gardent leurs `name` et sont postés normalement à la fin.
  const [merchantName, setMerchantName] = useState("");
  const [managerName, setManagerName] = useState("");
  // Forme canonique PhoneField (null tant qu'invalide).
  const [phone, setPhone] = useState<string | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [locationValid, setLocationValid] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ---------------------------------------------------------------------------
  // BROUILLON par étape (mig 0414) : chaque étape franchie est enregistrée
  // côté serveur (fire-and-forget, jamais bloquant) pour que le super-admin
  // puisse recontacter les commerçants qui n'ont pas finalisé. Le jeton
  // draft_key vit en localStorage : un refresh reprend LE MÊME brouillon.
  // Le mot de passe n'est JAMAIS lu ni envoyé.
  // ---------------------------------------------------------------------------
  const formRef = useRef<HTMLFormElement>(null);
  const [draftKey, setDraftKey] = useState("");
  const lsKey = `coligo_signup_draft_${mode}`;
  useEffect(() => {
    let k: string | null = null;
    try {
      k = localStorage.getItem(lsKey);
    } catch {
      /* stockage indispo (webview restreinte) → brouillon par session */
    }
    if (!k || !/^[0-9a-f-]{36}$/i.test(k)) {
      k = crypto.randomUUID();
      try {
        localStorage.setItem(lsKey, k);
      } catch {
        /* idem */
      }
    }
    setDraftKey(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const persistDraft = (stepReached: number) => {
    if (!draftKey || !formRef.current) return;
    const fd = new FormData(formRef.current);
    const val = (n: string) => {
      const v = fd.get(n);
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    let categories: string[] | undefined;
    try {
      const raw = val("categories");
      if (raw) {
        categories = (JSON.parse(raw) as unknown[]).filter(
          (x): x is string => typeof x === "string"
        );
      }
    } catch {
      /* champ absent/illisible */
    }
    saveSignupDraft({
      key: draftKey,
      source: mode,
      step: stepReached,
      stepsTotal: steps.length,
      merchantName: val("merchantName"),
      managerName: val("managerName"),
      phone: val("phone"),
      email: mode === "email" ? val("email") : undefined,
      categories,
      wilayaCode: val("wilayaCode"),
      city: val("city"),
      address: val("address"),
      latitude: val("latitude"),
      longitude: val("longitude"),
    })
      .then((res) => {
        // Clé tournée par le serveur (brouillon précédent déjà finalisé).
        if (res?.key && res.key !== draftKey) {
          setDraftKey(res.key);
          try {
            localStorage.setItem(lsKey, res.key);
          } catch {
            /* ok */
          }
        }
      })
      .catch(() => {
        /* jamais bloquant */
      });
  };

  // Inscription aboutie (confirmation email) → le brouillon est terminé côté
  // serveur ; on oublie le jeton local pour repartir propre la prochaine fois.
  useEffect(() => {
    if (!state.success) return;
    try {
      localStorage.removeItem(lsKey);
    } catch {
      /* ok */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  // Mêmes minimums que le serveur (lib/validation/auth.ts) — jamais plus
  // laxiste, pour ne pas découvrir un rejet zod à la dernière étape.
  const stepValid: Record<StepKey, boolean> = {
    shop:
      merchantName.trim().length > 0 &&
      managerName.trim().length > 0 &&
      phone !== null,
    types: cats.length > 0,
    location: locationValid,
    account:
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8,
  };
  const canContinue = stepValid[active];

  const stepHint: Record<StepKey, string> = {
    shop: tr(
      "Indiquez le commerce, le responsable et un téléphone valide.",
      "أدخل اسم المتجر والمسؤول ورقم هاتف صالح."
    ),
    types: tr("Choisissez au moins un type.", "اختر نوعًا واحدًا على الأقل."),
    location: tr(
      "Placez puis confirmez la position exacte sur la carte.",
      "ضع الموقع الدقيق على الخريطة ثم أكّده."
    ),
    account: tr(
      "Email valide et mot de passe d'au moins 8 caractères.",
      "بريد إلكتروني صالح وكلمة سر من 8 أحرف على الأقل."
    ),
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    if (!canContinue) return;
    // Étape franchie → brouillon enregistré (étape atteinte = la suivante).
    persistDraft(step + 2);
    setStep((s) => Math.min(steps.length - 1, s + 1));
  };
  const onFormKeyDown = makeWizardKeyDown(isLast, goNext);

  // Filet : dès qu'une étape devient complète (position confirmée, email
  // valide…), le brouillon est enregistré même sans « Continuer » — débouncé.
  useEffect(() => {
    if (!draftKey || pending || !canContinue) return;
    const t = setTimeout(() => persistDraft(step + 1), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftKey,
    step,
    canContinue,
    merchantName,
    managerName,
    phone,
    cats,
    locationValid,
    email,
  ]);

  // Inscription email sans session : le compte attend la confirmation email —
  // écran de fin dédié à la place du formulaire.
  if (state.success) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100">
          <MailCheck className="size-6 text-green-700" />
        </div>
        <p className="text-sm text-green-800">{state.success}</p>
        <Link href="/login" className={cn(buttonVariants(), "w-full")}>
          {tr("Se connecter", "تسجيل الدخول")}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Link>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onKeyDown={onFormKeyDown}
      className="space-y-3"
    >
      {/* Jeton du brouillon : la finalisation le marque « completed ». */}
      <input type="hidden" name="draftKey" value={draftKey} />
      <StepWizardStyle />
      <StepWizardHeader
        title={STEP_META[active].title}
        subtitle={STEP_META[active].subtitle}
        stepLabel={tr(
          `Étape ${step + 1} sur ${steps.length}`,
          `الخطوة ${step + 1} من ${steps.length}`
        )}
        step={step}
        total={steps.length}
      />

      {/* Panneaux : TOUS restent montés (saisie + inputs cachés préservés),
          l'inactif est masqué — display:none coupe l'animation, qui rejoue
          d'elle-même à la réapparition. */}

      {/* ÉTAPE — Votre commerce */}
      <div
        className={cn("space-y-3", active === "shop" ? "swz-panel" : "hidden")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="merchantName">
            {tr("Nom du commerce", "اسم المتجر")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <Store className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="merchantName"
              name="merchantName"
              type="text"
              placeholder="Boulangerie El Karim"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="managerName">
            {tr("Nom & prénom du responsable", "لقب واسم المسؤول")}{" "}
            <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <UserRound className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="managerName"
              name="managerName"
              type="text"
              placeholder="Karim Benali"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
        </div>

        {/* Téléphone dès l'étape 1 : l'équipe Coligo peut vous accompagner
            même si l'inscription n'est pas terminée. */}
        <PhoneField
          name="phone"
          required
          disabled={pending}
          onValueChange={(canonical) => setPhone(canonical)}
          hint={tr(
            "Pour vous joindre au sujet de votre boutique.",
            "للتواصل معك بخصوص متجرك."
          )}
        />
      </div>

      {/* ÉTAPE — Type de commerce */}
      <div
        className={cn(
          "space-y-1.5",
          active === "types" ? "swz-panel" : "hidden"
        )}
      >
        <Label>
          {tr("Types de commerce", "أنواع النشاط")}{" "}
          <span className="text-rose-600">*</span>
        </Label>
        <CategoryMultiSelect
          value={cats}
          onChange={setCats}
          disabled={pending}
        />
        <p className="text-subtle text-xs">
          {tr(
            "Plusieurs types possibles (ex. pizzeria + fast-food).",
            "يمكن اختيار عدة أنواع (مثال: بيتزيريا + وجبات سريعة)."
          )}
        </p>
      </div>

      {/* ÉTAPE — Emplacement */}
      <div className={active === "location" ? "swz-panel" : "hidden"}>
        <ShopLocationPicker
          names={{
            wilaya: "wilayaCode",
            commune: "city",
            address: "address",
            lat: "latitude",
            lng: "longitude",
          }}
          initial={{ wilayaCode: "16" }}
          disabled={pending}
          requireConfirm
          gpsAutofill
          onValidityChange={setLocationValid}
        />
      </div>

      {/* ÉTAPE — Votre compte (inscription email uniquement) */}
      {mode === "email" && (
        <div
          className={cn(
            "space-y-3",
            active === "account" ? "swz-panel" : "hidden"
          )}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">
              {tr("Email", "البريد الإلكتروني")}{" "}
              <span className="text-rose-600">*</span>
            </Label>
            <div className="relative">
              <Mail className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="vous@exemple.dz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={pending}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">
              {tr("Mot de passe", "كلمة المرور")}{" "}
              <span className="text-rose-600">*</span>
            </Label>
            <div className="relative">
              <Lock className="text-subtle pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2" />
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder={tr("Au moins 8 caractères", "8 أحرف على الأقل")}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={pending}
                className="pl-9"
              />
            </div>
          </div>
        </div>
      )}

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
        onSubmitClick={() => persistDraft(steps.length)}
        hint={stepHint[active]}
        submitContent={
          pending ? (
            tr("Création…", "جارٍ الإنشاء…")
          ) : (
            <>
              {mode === "email"
                ? tr("Créer mon compte", "إنشاء حسابي")
                : tr("Créer ma boutique", "إنشاء متجري")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </>
          )
        }
      />

      {mode === "email" && (
        <p className="text-muted pt-2 text-center text-xs">
          {tr(
            "En vous inscrivant, vous acceptez les",
            "بتسجيلك، فأنت توافق على"
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
          </Link>{" "}
          {tr(`de ${APP_CONFIG.name}.`, `الخاصة بـ ${APP_CONFIG.name}.`)}
        </p>
      )}
    </form>
  );
}
