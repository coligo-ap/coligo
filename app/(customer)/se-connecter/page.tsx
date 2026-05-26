"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import {
  customerLogin,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

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

  return (
    <>
      <div className="flex min-h-screen flex-col pb-20 lg:pb-0">
        <AuthNavBar variant="customer" />
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
          {/* Colonne marketing */}
          <aside className="from-primary-500 via-primary-600 to-primary-700 hidden flex-col justify-between bg-gradient-to-br p-12 text-white lg:col-span-2 lg:flex">
            <Logo variant="amber" size="xl" iconOnly className="!gap-0" />
            <div>
              <h1 className="mb-4 text-4xl leading-tight font-bold">
                Vos commerces de quartier,
                <br />
                en un clic.
              </h1>
              <p className="text-primary-50/90 mb-8 text-lg">
                Commandez à l&apos;avance, récupérez sur place. Sans attente.
              </p>
            </div>
            <p className="text-primary-50/70 text-xs">
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
                  Content de te revoir
                </h2>
                <p className="text-muted mb-6 text-sm">
                  Connecte-toi pour suivre tes commandes.
                </p>

                <form action={formAction} className="space-y-4">
                  <input type="hidden" name="next" value={next} />
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
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
                        className="pl-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Mot de passe</Label>
                      <Link
                        href="/mot-de-passe-oublie"
                        className="text-muted hover:text-primary-700 text-xs"
                      >
                        Oublié ?
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
                        className="pl-9"
                      />
                    </div>
                  </div>

                  {state.error && (
                    <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                      {state.error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={pending}
                  >
                    {pending ? (
                      "Connexion…"
                    ) : (
                      <>
                        Se connecter <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
                  Pas encore inscrit ?{" "}
                  <Link
                    href={signupHref}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    Créer un compte
                  </Link>
                </div>

                <div className="mt-6 text-center text-xs">
                  <Link href="/" className="text-muted hover:text-foreground">
                    ← Retour à l&apos;accueil
                  </Link>
                  <span className="text-muted mx-2">·</span>
                  <Link
                    href="/login"
                    className="text-muted hover:text-foreground"
                  >
                    Je suis commerçant
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
