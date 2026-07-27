"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <AuthScreen
      navVariant="merchant"
      installLabel={tr(
        "Installer l'application Commerçant",
        "ثبّت تطبيق التاجر"
      )}
      hero={{
        title: isAr ? (
          <>
            انضم إلى {APP_CONFIG.name}.<br />
            بِع بدون تعقيدات.
          </>
        ) : (
          <>
            Rejoignez {APP_CONFIG.name}.<br />
            Vendez sans complications.
          </>
        ),
        subtitle: tr(
          "Une plateforme gratuite à l'inscription. Vous ne payez qu'une commission sur les commandes.",
          "منصة مجانية عند التسجيل. لا تدفع سوى عمولة على الطلبات."
        ),
        stats: [
          { value: tr("0 DA", "0 دج"), label: tr("Inscription", "التسجيل") },
          { value: "5%", label: tr("Commission", "العمولة") },
          {
            value: tr("2 min", "دقيقتان"),
            label: tr("Création de compte", "إنشاء الحساب"),
          },
          { value: "24/7", label: tr("Support", "الدعم") },
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr("Créer mon compte", "إنشاء حسابي")}
      cardSubtitle={tr(
        "Une question à la fois, en 2 minutes.",
        "سؤال واحد في كل خطوة، في دقيقتين."
      )}
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
                or: tr("ou plus rapide", "أو أسرع"),
                button: tr("S'inscrire avec Google", "التسجيل عبر Google"),
                error: tr(
                  "La connexion Google a échoué. Réessayez.",
                  "فشل تسجيل الدخول عبر Google. أعد المحاولة."
                ),
              }}
            />
          </div>
          <div className="border-border text-muted mt-6 border-t pt-4 text-center text-xs">
            {tr("Tu es livreur ?", "هل أنت موصّل؟")}{" "}
            <Link
              href="/driver/login"
              className="text-primary-700 font-medium hover:underline"
            >
              {tr("Se connecter", "تسجيل الدخول")}
            </Link>{" "}
            ·{" "}
            <Link
              href="/driver/signup"
              className="text-primary-700 font-medium hover:underline"
            >
              {tr("S'inscrire", "التسجيل")}
            </Link>{" "}
            {tr("en tant que livreur", "كموصّل")}
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
