"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Car, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { SocialAuth } from "@/components/customer/social-auth";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import {
  customerLogin,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

// Photo professionnelle de fond du panneau marketing (gauche, desktop) — même
// traitement que la page de connexion commerçant (photo + ombre noire + texte
// blanc). Pour utiliser ta propre image : dépose-la dans public/ et remplace
// par "/login-client-hero.jpg". Le dégradé primaire reste en fond de secours.
const HERO_IMG =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80";

export default function CustomerLoginPage() {
  // Suspense requise par Next 15 dès qu'on utilise useSearchParams dans une
  // page rendue côté serveur statiquement.
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
  const signupHref =
    next === "/"
      ? "/inscription"
      : `/inscription?next=${encodeURIComponent(next)}`;
  const oauthError = params.get("error") === "oauth";

  return (
    <>
      <div className="flex min-h-screen flex-col pb-20 lg:pb-0">
        <AuthNavBar variant="customer" />
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
          {/* Colonne marketing à gauche (desktop only) — photo pro + ombre
              noire (même traitement que les cartes commerçants de la
              marketplace et la page de login commerçant) + texte blanc. */}
          <aside className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:col-span-2 lg:flex">
            {/* Fond de secours (si la photo ne charge pas) */}
            <div
              aria-hidden
              className="from-primary-500 via-primary-600 to-primary-800 absolute inset-0 bg-gradient-to-br"
            />
            {/* Photo professionnelle */}
            <div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${HERO_IMG}")` }}
            />
            {/* Ombre noire (dégradé) pour la lisibilité du texte blanc */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35"
            />

            <div className="relative z-10">
              <Logo variant="amber" size="xl" iconOnly className="!gap-0" />
            </div>

            <div className="relative z-10">
              <h1 className="mb-4 text-4xl leading-tight font-bold drop-shadow-md">
                {t.rich("heroTitle", { br: () => <br /> })}
              </h1>
              <p className="mb-8 text-lg text-white/90 drop-shadow">
                {t("heroSubtitle")}
              </p>

              <div className="space-y-4 text-sm">
                <Feature title={t("feature1")} />
                <Feature title={t("feature2")} />
                <Feature title={t("feature3")} />
                <Feature title={t("feature4")} />
              </div>
            </div>

            <p className="relative z-10 text-xs text-white/70 drop-shadow">
              © {new Date().getFullYear()} {APP_CONFIG.name}
            </p>
          </aside>

          {/* Formulaire */}
          <main className="bg-surface-2 flex items-center justify-center p-4 lg:col-span-3 lg:bg-white lg:p-12">
            <div className="w-full max-w-md">
              <div className="mb-8 flex justify-center lg:hidden">
                <Logo variant="amber" size="lg" />
              </div>

              <div className="border-border rounded-[14px] border bg-white p-6 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                <h2 className="text-foreground mb-1 text-2xl font-bold lg:text-3xl">
                  {t("welcomeBack")}
                </h2>
                <p className="text-muted mb-6 text-sm">{t("loginSubtitle")}</p>

                <form action={formAction} className="space-y-4">
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
                      <Lock className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        required
                        disabled={pending}
                        className="ps-9"
                      />
                    </div>
                  </div>

                  {(state.error || oauthError) && (
                    <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                      {state.error ?? t("googleAuthFailed")}
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={pending}
                  >
                    {pending ? (
                      t("signingIn")
                    ) : (
                      <>
                        {t("signIn")}{" "}
                        <ArrowRight className="size-4 rtl:-scale-x-100" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="mt-5">
                  <SocialAuth next={next} />
                </div>

                <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
                  {t("notRegisteredYet")}{" "}
                  <Link
                    href={signupHref}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    {t("createAccount")}
                  </Link>
                </div>

                <div className="mt-6 text-center text-xs">
                  <Link href="/" className="text-muted hover:text-foreground">
                    {t("backToHome")}
                  </Link>
                  <span className="text-muted mx-2">·</span>
                  <Link
                    href="/login"
                    className="text-muted hover:text-foreground"
                  >
                    {t("iAmMerchant")}
                  </Link>
                  <span className="text-muted mx-2">·</span>
                  <Link
                    href="/chauffeur"
                    className="text-muted hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Car className="size-3.5" />
                    {t("iAmDriver")}
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
        <AuthFooter />
      </div>
      <CustomerBottomNav />
    </>
  );
}

function Feature({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 drop-shadow">
      <div className="bg-primary-500 flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white/25">
        <svg
          className="size-3.5 text-white"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <span>{title}</span>
    </div>
  );
}
