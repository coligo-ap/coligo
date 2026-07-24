"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Lock, Mail, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { SocialAuth } from "@/components/customer/social-auth";
import { ReferralCodeField } from "@/components/customer/referral/referral-code-field";
import {
  customerSignup,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

// Bandeau d'installation relevé au-dessus de la nav basse client (fermable).
const INSTALL_POS =
  "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] lg:bottom-4";

export default function CustomerSignupPage() {
  // Suspense requise par Next 15 dès qu'on utilise useSearchParams.
  return (
    <Suspense fallback={null}>
      <CustomerSignupInner />
    </Suspense>
  );
}

function CustomerSignupInner() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(
    customerSignup,
    initialState
  );
  const params = useSearchParams();
  const refCode = params.get("ref") ?? "";
  const rawNext = params.get("next") ?? "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  // Les deux liens du sélecteur de mode conservent la destination demandée.
  const loginHref =
    next === "/"
      ? "/se-connecter"
      : `/se-connecter?next=${encodeURIComponent(next)}`;
  const signupHref =
    next === "/"
      ? "/inscription"
      : `/inscription?next=${encodeURIComponent(next)}`;

  return (
    <AuthScreen
      navVariant="customer"
      installClassName={INSTALL_POS}
      bottomNav={<CustomerBottomNav />}
      hero={{
        title: t.rich("signupHeroTitle", { br: () => <br /> }),
        subtitle: t("signupHeroSubtitle"),
        stats: [
          { value: "0 DA", label: t("statSignup") },
          { value: "3 %", label: t("statCashback") },
          { value: "0 file", label: t("statWaiting") },
          { value: "24/7", label: t("statAvailable") },
        ],
      }}
      cardTitle={t("welcome")}
      cardSubtitle={t("signupSubtitle")}
      modeTabs={
        <AuthModeTabs
          mode="signup"
          loginHref={loginHref}
          signupHref={signupHref}
          loginLabel={t("modeLogin")}
          signupLabel={t("modeSignup")}
        />
      }
      footer={
        <>
          <div className="mt-3">
            <SocialAuth next={next} />
          </div>
          <div className="mt-4 text-center text-xs">
            <Link href="/" className="text-muted hover:text-foreground">
              {t("backToHome")}
            </Link>
          </div>
        </>
      }
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field
          id="full_name"
          label={t("fullName")}
          icon={User}
          inputProps={{
            name: "full_name",
            required: true,
            minLength: 2,
            maxLength: 80,
            autoComplete: "name",
            placeholder: t("fullNamePlaceholder"),
          }}
          disabled={pending}
        />

        <Field
          id="phone"
          label={t("phone")}
          hint={t("phoneHint")}
          icon={Phone}
          inputProps={{
            name: "phone",
            type: "tel",
            required: true,
            autoComplete: "tel",
            placeholder: "0550 12 34 56",
            inputMode: "tel",
          }}
          disabled={pending}
        />

        <Field
          id="email"
          label={t("email")}
          icon={Mail}
          inputProps={{
            name: "email",
            type: "email",
            required: true,
            autoComplete: "email",
            placeholder: "vous@exemple.dz",
          }}
          disabled={pending}
        />

        <Field
          id="password"
          label={t("password")}
          hint={t("passwordHint")}
          icon={Lock}
          inputProps={{
            name: "password",
            type: "password",
            required: true,
            minLength: 8,
            autoComplete: "new-password",
            placeholder: "••••••••",
          }}
          disabled={pending}
        />

        <ReferralCodeField initialCode={refCode} disabled={pending} />

        {state.error && (
          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {state.error}
          </div>
        )}
        {state.success && (
          <div className="border-success-200 bg-success-50 text-success-800 rounded-[10px] border px-3 py-2.5 text-sm">
            {state.success}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            t("creating")
          ) : (
            <>
              {t("createMyAccount")}{" "}
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            </>
          )}
        </Button>

        <p className="text-subtle pt-1 text-center text-xs">
          {t.rich("signupConsent", {
            cgu: (chunks) => (
              <Link
                href="/cgu"
                className="text-primary-700 font-medium hover:underline"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href="/confidentialite"
                className="text-primary-700 font-medium hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </form>
    </AuthScreen>
  );
}

function Field({
  id,
  label,
  hint,
  icon: Icon,
  inputProps,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input id={id} {...inputProps} disabled={disabled} className="ps-9" />
      </div>
      {hint && <p className="text-subtle text-xs">{hint}</p>}
    </div>
  );
}
