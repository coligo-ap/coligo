"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneField } from "@/components/ui/phone-field";
import { partnerLogin, type PartnerAuthState } from "@/app/(partner)/actions";

const initial: PartnerAuthState = {};

export function PartnerLoginForm() {
  const [state, action, pending] = useActionState(partnerLogin, initial);
  return (
    <form action={action} className="space-y-3">
      <PhoneField required disabled={pending} />
      <div className="space-y-1.5">
        <Label htmlFor="password">Mot de passe</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>
      {state.error && (
        <p className="text-danger-700 text-sm font-medium">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Se connecter
      </Button>
    </form>
  );
}
