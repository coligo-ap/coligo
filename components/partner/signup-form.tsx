"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Store, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneField } from "@/components/ui/phone-field";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
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

const META: Record<StepKey, { title: string; subtitle: string }> = {
  point: {
    title: "Votre point de recharge",
    subtitle: "Son nom, et celui du gérant.",
  },
  dossier: {
    title: "Votre dossier",
    subtitle: "Le registre de commerce du point.",
  },
  location: {
    title: "Emplacement",
    subtitle: "Placez le point sur la carte — il apparaîtra aux clients.",
  },
  access: {
    title: "Vos accès",
    subtitle: "Le téléphone sera votre identifiant de connexion.",
  },
};

/**
 * Auto-inscription Agent Coligo Pay ÉTAPE PAR ÉTAPE (style Bolt Food) : point →
 * dossier → emplacement → accès. UN SEUL <form>, panneaux tous MONTÉS (l'inactif
 * en `hidden`) — la soumission finale poste les mêmes champs qu'avant à
 * `partnerSignup`, zéro changement backend. Les PIÈCES (RC, identité) restent
 * déposées juste après, depuis l'espace agent (« Mon dossier »).
 */
export function PartnerSignupForm() {
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
    point: "Indiquez le nom du point et celui du gérant.",
    dossier: "Le n° de registre de commerce est requis.",
    location: "Placez puis confirmez la position exacte sur la carte.",
    access: "Téléphone valide et mot de passe de 6 caractères minimum.",
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
      <StepWizardHeader
        title={META[active].title}
        subtitle={META[active].subtitle}
        stepLabel={`Étape ${step + 1} sur ${STEPS.length}`}
        step={step}
        total={STEPS.length}
      />

      {/* ÉTAPE — Le point (panneaux tous montés, l'inactif masqué) */}
      <div
        className={cn("space-y-3", active === "point" ? "swz-panel" : "hidden")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="displayName">
            Nom du point de recharge <span className="text-rose-600">*</span>
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
            Nom &amp; prénom du gérant <span className="text-rose-600">*</span>
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
            N° de registre de commerce <span className="text-rose-600">*</span>
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
          <Label htmlFor="hours">Horaires (optionnel)</Label>
          <Input
            id="hours"
            name="hours"
            type="text"
            placeholder="08h – 20h, tous les jours"
            disabled={pending}
          />
        </div>

        <p className="text-subtle text-xs">
          Les pièces (registre, identité) se déposent juste après, depuis votre
          espace agent.
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
          hint="Votre identifiant de connexion."
        />

        <div className="space-y-1.5">
          <Label htmlFor="password">
            Mot de passe <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            placeholder="Au moins 6 caractères"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={pending}
          />
        </div>
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
        labels={{ back: "Retour", next: "Continuer" }}
        hint={stepHint[active]}
        submitContent={
          pending ? (
            "Envoi de la demande…"
          ) : (
            <>
              Envoyer ma demande
              <ArrowRight className="size-4" />
            </>
          )
        }
      />

      <p className="text-subtle text-center text-xs">
        En envoyant votre demande, vous acceptez les{" "}
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
        </Link>
        .
      </p>
    </form>
  );
}
