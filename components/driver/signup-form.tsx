"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneField } from "@/components/ui/phone-field";
import { WILAYAS } from "@/lib/dz/wilayas";
import { driverSignup, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverSignupForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "";
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, action, pending] = useActionState(driverSignup, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="first_name">{tr("Prénom", "الاسم")}</Label>
          <Input
            id="first_name"
            name="first_name"
            type="text"
            autoComplete="given-name"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">{tr("Nom", "اللقب")}</Label>
          <Input
            id="last_name"
            name="last_name"
            type="text"
            autoComplete="family-name"
            required
            disabled={pending}
          />
        </div>
      </div>

      <PhoneField
        label={tr("Téléphone", "الهاتف")}
        required
        disabled={pending}
        hint={tr("Ton identifiant de connexion.", "معرّف تسجيل الدخول.")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="email">{tr("Email", "البريد الإلكتروني")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="exemple@email.com"
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wilaya">{tr("Wilaya", "الولاية")}</Label>
        <select
          id="wilaya"
          name="wilaya"
          required
          disabled={pending}
          defaultValue=""
          className="h-12 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] outline-none focus:border-[#6c2bd9] disabled:opacity-50"
        >
          <option value="" disabled>
            {tr("Choisis ta wilaya", "اختر ولايتك")}
          </option>
          {WILAYAS.map((w, i) => (
            <option key={w} value={w}>
              {String(i + 1).padStart(2, "0")} · {w}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">{tr("Mot de passe", "كلمة المرور")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
          disabled={pending}
        />
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {tr("Créer mon compte", "إنشاء حسابي")}
      </Button>

      <p className="text-subtle text-center text-xs">
        {tr(
          "En créant un compte, vous acceptez les ",
          "بإنشاء حساب، فإنك توافق على "
        )}
        <Link
          href="/cgu"
          className="text-primary-700 font-medium hover:underline"
        >
          {tr("Conditions générales", "الشروط العامة")}
        </Link>
        {tr(" et la ", " و")}
        <Link
          href="/confidentialite"
          className="text-primary-700 font-medium hover:underline"
        >
          {tr("Politique de confidentialité", "سياسة الخصوصية")}
        </Link>
        .
      </p>
    </form>
  );
}
