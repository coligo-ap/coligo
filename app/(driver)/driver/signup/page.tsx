import { Suspense } from "react";
import { DriverSignupForm } from "@/components/driver/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=1400&q=80";

export default function DriverSignupPage() {
  return (
    <AuthScreen
      navVariant="driver"
      installLabel="Installer l'application Livreur"
      hero={{
        title: (
          <>
            Devenez livreur <br />
            partenaire Coligo.
          </>
        ),
        subtitle:
          "Créez votre compte, transmettez vos documents, et commencez à livrer dès la validation.",
        features: [
          "Inscription guidée, étape par étape",
          "Vérification par l'équipe Coligo sous 24 à 48 h",
          "Recevez des courses près de chez vous",
          "Suivez vos gains en temps réel",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Créer mon compte"
      cardSubtitle="Renseignez vos informations pour créer votre compte livreur."
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
