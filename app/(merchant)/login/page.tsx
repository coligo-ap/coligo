"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { login, type AuthState } from "../actions";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Mail, Lock, ArrowRight } from "lucide-react";

const initialState: AuthState = {};

const ERROR_MESSAGES: Record<string, string> = {
  confirm_failed: "Le lien de confirmation est invalide ou expiré.",
  no_merchant:
    "Aucune boutique n'est associée à ce compte. Recréez un compte ou contactez le support.",
  merchant_query_failed:
    "Impossible de charger votre boutique. Vérifiez la connexion à la base ou contactez le support.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const urlErrorMessage = urlError ? ERROR_MESSAGES[urlError] : null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-5">
      {/* Colonne marketing à gauche (desktop only) */}
      <aside className="hidden lg:flex lg:col-span-2 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 text-white p-12 flex-col justify-between">
        <Logo variant="amber" size="xl" iconOnly className="!gap-0" />

        <div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">
            Gérez vos commandes <br />
            en temps réel.
          </h1>
          <p className="text-lg text-primary-50/90 mb-8">
            La plateforme pensée pour les commerces de proximité algériens.
          </p>

          <div className="space-y-4 text-sm">
            <Feature title="Recevez vos commandes en direct" />
            <Feature title="Gérez votre catalogue et vos horaires" />
            <Feature title="Suivez votre chiffre d'affaires en temps réel" />
            <Feature title="Récupérez vos paiements simplement" />
          </div>
        </div>

        <p className="text-xs text-primary-50/70">
          © {new Date().getFullYear()} {APP_CONFIG.name} · Tous droits réservés
        </p>
      </aside>

      {/* Formulaire à droite */}
      <main className="lg:col-span-3 flex items-center justify-center p-4 lg:p-12 bg-surface-2 lg:bg-white">
        <div className="w-full max-w-md">
          {/* Logo mobile uniquement */}
          <div className="lg:hidden flex justify-center mb-8">
            <Logo variant="amber" size="lg" />
          </div>

          <div className="bg-white lg:bg-transparent rounded-[14px] lg:rounded-none border lg:border-0 border-border p-6 lg:p-0 shadow-sm lg:shadow-none">
            <div className="mb-6">
              <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-2">
                Bonjour
              </h2>
              <p className="text-sm lg:text-base text-muted">
                Connectez-vous à votre espace commerçant.
              </p>
            </div>

            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
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
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-primary-700"
                  >
                    Oublié ?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
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

              {(state.error || urlErrorMessage) && (
                <div className="rounded-[10px] bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm text-rose-800">
                  {state.error ?? urlErrorMessage}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={pending}
              >
                {pending ? "Connexion…" : (
                  <>
                    Se connecter
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted">
              Pas encore inscrit ?{" "}
              <Link
                href="/signup"
                className="text-primary-700 font-medium hover:underline"
              >
                Créer un compte commerçant
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Feature({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="size-6 rounded-full bg-primary-400/30 flex items-center justify-center shrink-0">
        <svg className="size-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
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
