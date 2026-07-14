import { getLocale } from "next-intl/server";
import { ChauffeurLoginForm } from "@/components/chauffeur/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Espace chauffeur" };

const HERO_IMG =
  "https://images.unsplash.com/photo-1549924231-f129b911e442?auto=format&fit=crop&w=1400&q=80";

export default async function ChauffeurLoginPage() {
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <AuthScreen
      navVariant="chauffeur"
      installLabel={tr(
        "Installer l'application Chauffeur",
        "ثبّت تطبيق السائق"
      )}
      hero={{
        title: isAr ? (
          <>
            قُد مع <br />
            كوليڨو درايف.
          </>
        ) : (
          <>
            Conduisez avec <br />
            Coligo Drive.
          </>
        ),
        subtitle: tr(
          "L'application des chauffeurs VTC partenaires de Coligo.",
          "تطبيق سائقي النقل الشركاء لكوليڨو."
        ),
        features: isAr
          ? [
              "استقبل طلبات المشاوير",
              "فاوض واقبل بلمسة واحدة",
              "تابع مداخيلك في الوقت الفعلي",
              "أدر وثائقك بكل بساطة",
            ]
          : [
              "Recevez des demandes de course",
              "Négociez et acceptez en un geste",
              "Suivez vos revenus en temps réel",
              "Gérez vos documents simplement",
            ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr(
        "Connexion · espace chauffeur",
        "تسجيل الدخول · فضاء السائق"
      )}
      cardSubtitle={tr("Vos courses et vos gains.", "مشاويرك وأرباحك.")}
      modeTabs={
        <AuthModeTabs
          mode="login"
          loginHref="/chauffeur/login"
          signupHref="/chauffeur/signup"
        />
      }
    >
      <ChauffeurLoginForm />
    </AuthScreen>
  );
}
