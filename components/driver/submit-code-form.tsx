"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { driverSubmitCode, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverSubmitCodeForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, action, pending] = useActionState(driverSubmitCode, initial);
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  // Le code peut venir du lien partagé par le commerçant : `?code=BOUL-XYZ`.
  const [code, setCode] = useState(sp.get("code") ?? "");

  useEffect(() => {
    if (state.ok && !pending) {
      // Laisse le bouton afficher "Demande envoyée ✓" 1.2 s avant redirect.
      const t = setTimeout(() => router.push("/driver"), 1200);
      return () => clearTimeout(t);
    }
  }, [state.ok, pending, router]);

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="code">{tr("Code de référence", "رمز المرجع")}</Label>
        <Input
          id="code"
          name="code"
          type="text"
          autoCapitalize="characters"
          placeholder="EX: BOULANGERIE-K4Q7X9"
          className="font-mono tracking-wider uppercase"
          required
          disabled={pending}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {sp.get("code") && (
          <p className="text-success-700 text-xs">
            ✓{" "}
            {tr(
              "Code pré-rempli depuis le lien partagé par le commerçant.",
              "تم ملء الرمز تلقائياً من رابط التاجر."
            )}
          </p>
        )}
      </div>
      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}
      <ActionButton
        type="submit"
        className="w-full"
        state={btnState}
        labels={{
          idle: tr("Envoyer", "إرسال"),
          pending: tr("Envoi en cours…", "جارٍ الإرسال…"),
          success: tr("Demande envoyée ✓", "تم إرسال الطلب ✓"),
          error: tr("Erreur, réessaie", "خطأ، أعد المحاولة"),
        }}
      />
    </form>
  );
}
