"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { driverLogin, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverLoginForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "";
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, action, pending] = useActionState(driverLogin, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="phone">{tr("Téléphone", "الهاتف")}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="+213 6XX XX XX XX"
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{tr("Mot de passe", "كلمة المرور")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          disabled={pending}
        />
      </div>
      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {tr("Se connecter", "تسجيل الدخول")}
      </Button>
    </form>
  );
}
