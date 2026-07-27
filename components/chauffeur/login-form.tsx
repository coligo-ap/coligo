"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneField } from "@/components/ui/phone-field";
import {
  chauffeurLogin,
  type ChauffeurAuthState,
} from "@/app/(chauffeur)/actions";

const initial: ChauffeurAuthState = {};

/**
 * Connexion chauffeur (téléphone + mot de passe). Présentation unifiée
 * « Coligo » (Input/Label/Button partagés) ; l'action serveur `chauffeurLogin`
 * et les noms de champs sont inchangés.
 */
export function ChauffeurLoginForm() {
  const [state, action, pending] = useActionState(chauffeurLogin, initial);
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <form action={action} className="space-y-3">
      <PhoneField required disabled={pending} />

      <div className="space-y-1.5">
        <Label htmlFor="password">{tr("Mot de passe", "كلمة المرور")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>

      {state.error && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {state.error}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          tr("Connexion…", "جارٍ الاتصال…")
        ) : (
          <>
            {tr("Se connecter", "تسجيل الدخول")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </>
        )}
      </Button>
    </form>
  );
}
