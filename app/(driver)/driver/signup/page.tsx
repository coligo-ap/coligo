import { Suspense } from "react";
import { getLocale } from "next-intl/server";
import { DriverSignupForm } from "@/components/driver/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=1400&q=80";

export default async function DriverSignupPage() {
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <AuthScreen
      navVariant="driver"
      installLabel={tr("Installer l'application Livreur", "ثبّت تطبيق الموصّل")}
      hero={{
        title: isAr ? (
          <>
            كن موصّلًا <br />
            شريكًا لكوليڨو.
          </>
        ) : (
          <>
            Devenez livreur <br />
            partenaire Coligo.
          </>
        ),
        subtitle: tr(
          "Créez votre compte, transmettez vos documents, et commencez à livrer dès la validation.",
          "أنشئ حسابك، أرسل وثائقك، وابدأ التوصيل فور المصادقة."
        ),
        features: isAr
          ? [
              "تسجيل موجّه، خطوة بخطوة",
              "تحقّق من فريق كوليڨو خلال 24 إلى 48 ساعة",
              "استقبل طلبات توصيل قريبة منك",
              "تابع أرباحك في الوقت الفعلي",
            ]
          : [
              "Inscription guidée, étape par étape",
              "Vérification par l'équipe Coligo sous 24 à 48 h",
              "Recevez des courses près de chez vous",
              "Suivez vos gains en temps réel",
            ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr("Créer mon compte", "إنشاء حسابي")}
      cardSubtitle={tr(
        "Quelques informations, et c'est parti.",
        "بعض المعلومات، وننطلق."
      )}
      modeTabs={
        <AuthModeTabs
          mode="signup"
          loginHref="/driver/login"
          signupHref="/driver/signup"
        />
      }
    >
      <Suspense fallback={null}>
        <DriverSignupForm />
      </Suspense>
    </AuthScreen>
  );
}
