"use client";

import Link from "next/link";
import { useActionState, useState, type KeyboardEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signup,
  completeSocialSignup,
  type AuthState,
} from "@/app/(merchant)/actions";
import { CategoryMultiSelect } from "@/components/merchant/settings/category-multi-select";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  ArrowLeft,
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

const STEP_META: Record<StepKey, { title: string; subtitle: string }> = {
  shop: {
    title: "Votre commerce",
    subtitle: "Son nom, et celui du responsable.",
  },
  types: {
    title: "Type de commerce",
    subtitle: "Le premier choisi est le principal.",
  },
  location: {
    title: "Emplacement",
    subtitle: "Placez votre boutique sur la carte.",
  },
  account: {
    title: "Votre compte",
    subtitle: "Vos identifiants de connexion.",
  },
};

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
  const [cats, setCats] = useState<string[]>([]);
  const [locationValid, setLocationValid] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Mêmes minimums que le serveur (lib/validation/auth.ts) — jamais plus
  // laxiste, pour ne pas découvrir un rejet zod à la dernière étape.
  const stepValid: Record<StepKey, boolean> = {
    shop: merchantName.trim().length > 0 && managerName.trim().length > 0,
    types: cats.length > 0,
    location: locationValid,
    account:
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8,
  };
  const canContinue = stepValid[active];

  const stepHint: Record<StepKey, string> = {
    shop: "Indiquez le nom du commerce et le responsable.",
    types: "Choisissez au moins un type.",
    location: "Placez puis confirmez la position exacte sur la carte.",
    account: "Email valide et mot de passe d'au moins 8 caractères.",
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    if (canContinue) setStep((s) => Math.min(steps.length - 1, s + 1));
  };

  // Entrée = « Continuer » sur les étapes intermédiaires (jamais une soumission
  // prématurée du formulaire complet via le submit implicite du navigateur).
  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || isLast) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement)
      return;
    e.preventDefault();
    goNext();
  };

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
          Se connecter
          <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} onKeyDown={onFormKeyDown} className="space-y-3">
      {/* Fondu doux du panneau qui (ré)apparaît — rejoue à chaque activation. */}
      <style>{`@keyframes swzFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.swz-panel{animation:swzFade .18s ease}`}</style>

      {/* Tête d'étape : titre + compteur + barre de progression segmentée. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">{STEP_META[active].title}</p>
          <p className="text-subtle text-xs">
            Étape {step + 1} sur {steps.length}
          </p>
        </div>
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "bg-primary-600" : "bg-surface-3"
              )}
            />
          ))}
        </div>
        <p className="text-subtle text-xs">{STEP_META[active].subtitle}</p>
      </div>

      {/* Panneaux : TOUS restent montés (saisie + inputs cachés préservés),
          l'inactif est masqué — display:none coupe l'animation, qui rejoue
          d'elle-même à la réapparition. */}

      {/* ÉTAPE — Votre commerce */}
      <div
        className={cn("space-y-3", active === "shop" ? "swz-panel" : "hidden")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="merchantName">
            Nom du commerce <span className="text-rose-600">*</span>
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
            Nom & prénom du responsable <span className="text-rose-600">*</span>
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
      </div>

      {/* ÉTAPE — Type de commerce */}
      <div
        className={cn(
          "space-y-1.5",
          active === "types" ? "swz-panel" : "hidden"
        )}
      >
        <Label>
          Types de commerce <span className="text-rose-600">*</span>
        </Label>
        <CategoryMultiSelect
          value={cats}
          onChange={setCats}
          disabled={pending}
        />
        <p className="text-subtle text-xs">
          Plusieurs types possibles (ex. pizzeria + fast-food).
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
              Email <span className="text-rose-600">*</span>
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
              Mot de passe <span className="text-rose-600">*</span>
            </Label>
            <div className="relative">
              <Lock className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Au moins 8 caractères"
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
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {state.error}
        </div>
      )}

      {/* Navigation : Retour + Continuer / soumission finale. */}
      <div className="flex gap-2 pt-1">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={pending}
          >
            <ArrowLeft className="size-4" />
            Retour
          </Button>
        )}
        {isLast ? (
          <Button
            type="submit"
            className="flex-1"
            disabled={pending || !canContinue}
          >
            {pending ? (
              "Création…"
            ) : (
              <>
                {mode === "email" ? "Créer mon compte" : "Créer ma boutique"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            className="flex-1"
            onClick={goNext}
            disabled={pending || !canContinue}
          >
            Continuer
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
      {!canContinue && (
        <p className="text-subtle text-center text-xs">{stepHint[active]}</p>
      )}

      {mode === "email" && (
        <p className="text-muted pt-2 text-center text-xs">
          En vous inscrivant, vous acceptez les{" "}
          <Link
            href="/cgu"
            className="text-primary-700 font-medium hover:underline"
          >
            Conditions générales
          </Link>{" "}
          et la{" "}
          <Link
            href="/confidentialite"
            className="text-primary-700 font-medium hover:underline"
          >
            Politique de confidentialité
          </Link>{" "}
          de {APP_CONFIG.name}.
        </p>
      )}
    </form>
  );
}
