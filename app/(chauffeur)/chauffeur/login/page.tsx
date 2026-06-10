"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  chauffeurLogin,
  type ChauffeurAuthState,
} from "@/app/(chauffeur)/actions";

const initial: ChauffeurAuthState = {};

export default function ChauffeurLoginPage() {
  const [state, action, pending] = useActionState(chauffeurLogin, initial);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <Car className="text-primary-600 mx-auto size-10" />
        <h1 className="mt-2 text-2xl font-bold">Espace chauffeur</h1>
        <p className="text-muted text-sm">
          Connecte-toi pour prendre des courses.
        </p>
      </div>
      <form action={action} className="space-y-4">
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
          <Label>Mot de passe</Label>
          <Input name="password" type="password" required />
        </div>
        {state.error && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Se connecter
        </Button>
      </form>
      <p className="text-muted mt-4 text-center text-sm">
        Pas encore chauffeur ?{" "}
        <Link
          href="/chauffeur/signup"
          className="text-primary-700 font-semibold"
        >
          Inscris-toi
        </Link>
      </p>
    </div>
  );
}
