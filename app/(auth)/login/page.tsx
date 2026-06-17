"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { login, type AuthState } from "@/app/(merchant)/actions";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { InstallBanner } from "@/components/pwa/install-banner";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";

const initialState: AuthState = {};

// Photo professionnelle de fond du panneau marketing (gauche, desktop).
// Pour utiliser ta propre image : dépose-la dans public/ et remplace par
// "/login-hero.jpg". Le dégradé primaire reste en fond de secours si l'image
// ne charge pas.
const HERO_IMG =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1400&q=80";

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
    <div className="flex min-h-screen flex-col">
      <AuthNavBar variant="merchant" />
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
        {/* Colonne marketing à gauche (desktop only) — photo pro + ombre noire
            (même traitement que les cartes commerçants de la marketplace) +
            texte en blanc par-dessus. */}
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
              Gérez vos commandes <br />
              en temps réel.
            </h1>
            <p className="mb-8 text-lg text-white/90 drop-shadow">
              La plateforme pensée pour les commerces de proximité algériens.
            </p>

            <div className="space-y-4 text-sm">
              <Feature title="Recevez vos commandes en direct" />
              <Feature title="Gérez votre catalogue et vos horaires" />
              <Feature title="Suivez votre chiffre d'affaires en temps réel" />
              <Feature title="Récupérez vos paiements simplement" />
            </div>
          </div>

          <p className="relative z-10 text-xs text-white/70">
            © {new Date().getFullYear()} {APP_CONFIG.name} · Tous droits
            réservés
          </p>
        </aside>

        {/* Formulaire à droite */}
        <main className="bg-surface-2 flex items-center justify-center p-4 lg:col-span-3 lg:bg-white lg:p-12">
          <div className="w-full max-w-md">
            {/* Logo mobile uniquement */}
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo variant="amber" size="lg" />
            </div>

            <div className="border-border rounded-[14px] border bg-white p-6 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              <div className="mb-6">
                <h2 className="text-foreground mb-2 text-2xl font-bold lg:text-3xl">
                  Espace commerçant
                </h2>
                <p className="text-muted text-sm lg:text-base">
                  Connectez-vous pour gérer vos commandes.
                </p>
              </div>

              <form action={formAction} className="space-y-4">
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
                      href="/login/mot-de-passe-oublie"
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

                {(state.error || urlErrorMessage) && (
                  <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                    {state.error ?? urlErrorMessage}
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
                      Se connecter
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
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
      <AuthFooter showPortal />
      {/* Petit popup d'installation, persistant jusqu'à l'install (fermable). */}
      <InstallBanner label="Installer l'application Commerçant" />
    </div>
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
