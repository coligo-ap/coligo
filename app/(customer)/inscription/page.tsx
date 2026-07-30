"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { SocialAuth } from "@/components/customer/social-auth";
import { CustomerSignupWizard } from "@/components/customer/signup-form";

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
      {/* Inscription STEP-BY-STEP (3 étapes, wizard partagé) — la phrase de
          transmission du téléphone au commerçant a été RETIRÉE. */}
      <CustomerSignupWizard next={next} refCode={refCode} />
    </AuthScreen>
  );
}
