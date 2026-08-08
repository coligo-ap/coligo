"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { SocialAuth } from "@/components/customer/social-auth";
import {
  customerLogin,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

// Photo professionnelle de fond du panneau marketing (gauche, desktop) — même
// traitement que la page de connexion commerçant. Pour utiliser ta propre
// image : dépose-la dans public/ et remplace par "/login-client-hero.jpg".
const HERO_IMG =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80";

// Bandeau d'installation relevé au-dessus de la nav basse client (fermable).
const INSTALL_POS =
  "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] lg:bottom-4";

export default function CustomerLoginPage() {
  // Suspense requise par Next 15 dès qu'on utilise useSearchParams.
  return (
    <Suspense fallback={null}>
      <CustomerLoginInner />
    </Suspense>
  );
}

function CustomerLoginInner() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(
    customerLogin,
    initialState
  );
  const params = useSearchParams();
  // `next` = retour souhaité après login (ex. /checkout). Sécurité : on
  // accepte uniquement des chemins relatifs qui commencent par "/".
  const rawNext = params.get("next") ?? "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  // Les deux liens du sélecteur de mode conservent la destination demandée.
  const signupHref =
    next === "/"
      ? "/inscription"
      : `/inscription?next=${encodeURIComponent(next)}`;
  const loginHref =
    next === "/"
      ? "/se-connecter"
      : `/se-connecter?next=${encodeURIComponent(next)}`;
  const oauthError = params.get("error") === "oauth";

  return (
    <AuthScreen
      navVariant="customer"
      installClassName={INSTALL_POS}
      bottomNav={<CustomerBottomNav />}
      hero={{
        title: t.rich("heroTitle", { br: () => <br /> }),
        subtitle: t("heroSubtitle"),
        features: [t("feature1"), t("feature2"), t("feature3"), t("feature4")],
        imageUrl: HERO_IMG,
      }}
      cardTitle={t("welcomeBack")}
      cardSubtitle={t("loginSubtitle")}
      modeTabs={
        <AuthModeTabs
          mode="login"
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
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <div className="relative">
            <Mail className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="vous@exemple.dz"
              required
              disabled={pending}
              className="ps-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link
              href="/mot-de-passe-oublie"
              className="text-muted hover:text-primary-700 text-xs"
            >
              {t("forgotShort")}
            </Link>
          </div>
          <div className="relative">
            <Lock className="text-subtle pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2" />
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              disabled={pending}
              className="ps-9"
            />
          </div>
        </div>

        {(state.error || oauthError) && (
          <div className="rounded-control border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {state.error ?? t("googleAuthFailed")}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            t("signingIn")
          ) : (
            <>
              {t("signIn")} <ArrowRight className="size-4 rtl:-scale-x-100" />
            </>
          )}
        </Button>
      </form>
    </AuthScreen>
  );
}
