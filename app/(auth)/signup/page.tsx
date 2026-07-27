"use client";

import Link from "next/link";
import { APP_CONFIG } from "@/lib/config/app-config";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { SocialAuth } from "@/components/customer/social-auth";
import { ShopSignupWizard } from "@/components/merchant/shop-signup-wizard";

// Photo professionnelle de fond du panneau marketing (gauche, desktop).
// Différente de la page de connexion. Remplaçable : dépose ton image dans
// public/ et pointe sur "/signup-hero.jpg". Le dégradé reste en secours.
const HERO_IMG =
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80";

export default function SignupPage() {
  return (
    <AuthScreen
      navVariant="merchant"
      installLabel="Installer l'application Commerçant"
      hero={{
        title: (
          <>
            Rejoignez {APP_CONFIG.name}.<br />
            Vendez sans complications.
          </>
        ),
        subtitle:
          "Une plateforme gratuite à l'inscription. Vous ne payez qu'une commission sur les commandes.",
        stats: [
          { value: "0 DA", label: "Inscription" },
          { value: "5%", label: "Commission" },
          { value: "2 min", label: "Création de compte" },
          { value: "24/7", label: "Support" },
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Créer mon compte"
      cardSubtitle="Une question à la fois, en 2 minutes."
      modeTabs={
        <AuthModeTabs mode="signup" loginHref="/login" signupHref="/signup" />
      }
      footer={
        <>
          <div className="mt-3">
            {/* Inscription Google — le compte est créé par Google, la boutique
                se complète ensuite sur /signup/boutique (mêmes étapes). */}
            <SocialAuth
              intent="merchant"
              labels={{
                or: "ou plus rapide",
                button: "S'inscrire avec Google",
                error: "La connexion Google a échoué. Réessayez.",
              }}
            />
          </div>
          <div className="border-border text-muted mt-6 border-t pt-4 text-center text-xs">
            Tu es livreur ?{" "}
            <Link
              href="/driver/login"
              className="text-primary-700 font-medium hover:underline"
            >
              Se connecter
            </Link>{" "}
            ·{" "}
            <Link
              href="/driver/signup"
              className="text-primary-700 font-medium hover:underline"
            >
              S&apos;inscrire
            </Link>{" "}
            en tant que livreur
          </div>
        </>
      }
    >
      {/* Inscription étape par étape (style Bolt Food) — mêmes champs et même
          action serveur qu'avant, seul le parcours change. */}
      <ShopSignupWizard mode="email" />
    </AuthScreen>
  );
}
