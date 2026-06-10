"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WILAYAS } from "@/lib/dz/wilayas";
import {
  chauffeurSignup,
  type ChauffeurAuthState,
} from "@/app/(chauffeur)/actions";

const initial: ChauffeurAuthState = {};

export default function ChauffeurSignupPage() {
  const [state, action, pending] = useActionState(chauffeurSignup, initial);
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-5 text-center">
        <Car className="text-primary-600 mx-auto size-10" />
        <h1 className="mt-2 text-2xl font-bold">Devenir chauffeur Coligo</h1>
        <p className="text-muted text-sm">
          Inscris-toi, ton compte sera vérifié avant de rouler.
        </p>
      </div>
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Nom complet</Label>
          <Input name="full_name" required maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label>Téléphone</Label>
          <Input
            name="phone"
            type="tel"
            placeholder="0X XX XX XX XX"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Wilaya</Label>
          <select
            name="wilaya"
            required
            defaultValue=""
            className="border-border-strong bg-surface h-12 w-full rounded-[12px] border px-4 text-sm"
          >
            <option value="" disabled>
              Choisir…
            </option>
            {WILAYAS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Marque</Label>
            <Input name="vehicle_make" placeholder="Renault" maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label>Modèle</Label>
            <Input name="vehicle_model" placeholder="Symbol" maxLength={40} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Plaque</Label>
            <Input name="vehicle_plate" placeholder="00123-114-16" required />
          </div>
          <div className="space-y-1.5">
            <Label>Couleur</Label>
            <Input name="vehicle_color" placeholder="Blanc" maxLength={20} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Mot de passe</Label>
          <Input name="password" type="password" required minLength={6} />
        </div>
        {state.error && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Créer mon compte chauffeur
        </Button>
      </form>
      <p className="text-muted mt-4 text-center text-sm">
        Déjà inscrit ?{" "}
        <Link
          href="/chauffeur/login"
          className="text-primary-700 font-semibold"
        >
          Se connecter
        </Link>
      </p>
    </div>
  );
}
