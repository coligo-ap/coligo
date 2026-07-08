"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * Inscription chauffeur : nom*, prénom*, tél*, date de naissance*,
 * wilaya/ville*, mot de passe*, GAMME du véhicule. Présentation unifiée
 * « Coligo » ; l'action serveur `chauffeurSignup`, les noms de champs et le
 * parcours (→ documents) sont inchangés.
 *
 * `connectedPhone` : si un chauffeur est déjà connecté sur l'appareil, on
 * affiche un bandeau de déconnexion (impossible d'inscrire un nouveau chauffeur
 * sans se déconnecter d'abord — sinon l'inscription échoue silencieusement).
 */
export function ChauffeurSignupForm({
  connectedPhone = null,
}: {
  connectedPhone?: string | null;
}) {
  const [state, action, pending] = useActionState(chauffeurSignup, initial);
  const [gamme, setGamme] = useState<"classic" | "confort" | "moto">("classic");

  return (
    <>
      {connectedPhone && (
        <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm text-amber-900">
            Vous êtes déjà connecté en tant que <b>{connectedPhone}</b>. Pour
            inscrire un autre chauffeur, déconnectez-vous d&apos;abord.
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
              Se déconnecter
            </Button>
          </form>
        </div>
      )}

      <form action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="last_name">
              Nom <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="last_name"
              name="last_name"
              type="text"
              autoComplete="family-name"
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="first_name">
              Prénom <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="first_name"
              name="first_name"
              type="text"
              autoComplete="given-name"
              required
              disabled={pending}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">
            Téléphone <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="07 / 06 / 05 XX XX XX XX"
            required
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="birth_date">
            Date de naissance <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="birth_date"
            name="birth_date"
            type="date"
            required
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="city">
            Wilaya / Ville <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="city"
            name="city"
            type="text"
            placeholder="Alger, Oran…"
            required
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">
            Mot de passe <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            disabled={pending}
          />
        </div>

        {/* Gamme du véhicule (boutons segmentés) */}
        <div className="space-y-1.5">
          <Label>
            Votre véhicule (gamme) <span className="text-rose-600">*</span>
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
                    ? "border-primary-600 bg-primary-50 text-primary-700 rounded-[10px] border px-2 py-2 text-sm font-semibold"
                    : "border-border text-foreground hover:bg-surface-2 rounded-[10px] border px-2 py-2 text-sm"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {state.error && (
          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {state.error}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={pending || !!connectedPhone}
        >
          {pending ? (
            "Création…"
          ) : (
            <>
              Continuer · mes documents
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>

        <p className="text-subtle text-center text-xs">
          En créant un compte, vous acceptez les{" "}
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
    </>
  );
}
