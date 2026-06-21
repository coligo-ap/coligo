"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  updateDriverProfile,
  type DriverAuthState,
} from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverProfileForm({
  initialFullName,
  initialPhone,
}: {
  initialFullName: string;
  initialPhone: string;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, action, pending] = useActionState(updateDriverProfile, initial);
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">{tr("Nom complet", "الاسم الكامل")}</Label>
        <Input
          id="full_name"
          name="full_name"
          defaultValue={initialFullName}
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">{tr("Téléphone", "الهاتف")}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={initialPhone}
          required
          disabled={pending}
        />
      </div>
      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}
      <ActionButton
        type="submit"
        state={btnState}
        labels={{
          idle: tr("Enregistrer", "حفظ"),
          pending: tr("Enregistrement…", "جارٍ الحفظ…"),
          success: tr("Profil enregistré ✓", "تم حفظ الملف ✓"),
          error: tr("Erreur, réessaie", "خطأ، أعد المحاولة"),
        }}
      />
    </form>
  );
}
