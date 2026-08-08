import { getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ChauffeurSignupForm } from "@/components/chauffeur/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Inscription chauffeur" };

const HERO_IMG = "/heros/chauffeur.webp";

export default async function ChauffeurSignupPage() {
  // Session chauffeur déjà active ? → bandeau « déconnexion » dans le formulaire
  // (indispensable pour inscrire un NOUVEAU chauffeur depuis le même appareil).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const connectedPhone = user?.email?.endsWith("@chauffeurs.coligo.local")
    ? user.email.split("@")[0]
    : null;
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
            كن سائقًا مع <br />
            كوليغو درايف.
          </>
        ) : (
          <>
            Devenez chauffeur <br />
            Coligo Drive.
          </>
        ),
        subtitle: tr(
          "Transportez des passagers avec Coligo Drive.",
          "انقل الركاب مع كوليغو درايف."
        ),
        features: isAr
          ? [
              "تسجيل سريع في خطوات قليلة",
              "اختر فئة مركبتك",
              "استقبل مشاوير قريبة منك",
              "تابع مداخيلك في الوقت الفعلي",
            ]
          : [
              "Inscription rapide en quelques étapes",
              "Choisissez la gamme de votre véhicule",
              "Recevez des courses près de vous",
              "Suivez vos revenus en temps réel",
            ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr("Créer mon compte", "إنشاء حسابي")}
      cardSubtitle={tr(
        "Vos informations, puis vos documents.",
        "معلوماتك، ثم وثائقك."
      )}
      modeTabs={
        <AuthModeTabs
          mode="signup"
          loginHref="/chauffeur/login"
          signupHref="/chauffeur/signup"
        />
      }
    >
      <ChauffeurSignupForm connectedPhone={connectedPhone} />
    </AuthScreen>
  );
}
