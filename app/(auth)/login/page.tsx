"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type AuthState } from "@/app/(merchant)/actions";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { SocialAuth } from "@/components/customer/social-auth";

const initialState: AuthState = {};

// Photo professionnelle de fond du panneau marketing (gauche, desktop).
// Pour utiliser ta propre image : dépose-la dans public/ et remplace par
// "/login-hero.jpg". Le dégradé primaire reste en fond de secours si l'image
// ne charge pas.
const HERO_IMG =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1400&q=80";

const ERROR_MESSAGES: Record<string, string> = {
  oauth: "La connexion Google a échoué. Réessayez.",
  customer_account:
    "Ce compte Google est déjà un compte client Coligo. Utilisez un autre compte Google pour votre boutique.",
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
    <AuthScreen
      navVariant="merchant"
      installLabel="Installer l'application Commerçant"
      showPortal
      hero={{
        title: (
          <>
            Gérez vos commandes <br />
            en temps réel.
          </>
        ),
        subtitle:
          "La plateforme pensée pour les commerces de proximité algériens.",
        features: [
          "Recevez vos commandes en direct",
          "Gérez votre catalogue et vos horaires",
          "Suivez votre chiffre d'affaires en temps réel",
          "Récupérez vos paiements simplement",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Connexion · espace commerçant"
      cardSubtitle="Gérez vos commandes."
      modeTabs={
        <AuthModeTabs mode="login" loginHref="/login" signupHref="/signup" />
      }
      footer={
        <div className="mt-3">
          {/* Connexion Google — même porte que le client, intention commerçant :
              boutique existante → /dashboard, sinon complétion /signup/boutique. */}
          <SocialAuth intent="merchant" next="/dashboard" />
        </div>
      }
    >
      <form action={formAction} className="space-y-3">
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

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
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
    </AuthScreen>
  );
}
