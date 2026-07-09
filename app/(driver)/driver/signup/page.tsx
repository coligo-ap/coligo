import Link from "next/link";
import { Suspense } from "react";
import { DriverSignupForm } from "@/components/driver/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";

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
      cardSubtitle="Renseignez vos informations pour créer votre compte livreur. Vous serez ensuite guidé pour transmettre vos documents à l'équipe Coligo."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Déjà inscrit ?{" "}
          <Link
            href="/driver/login"
            className="text-primary-700 font-medium hover:underline"
          >
            Se connecter
          </Link>
        </div>
      }
    >
      <Suspense fallback={null}>
        <DriverSignupForm />
      </Suspense>
    </AuthScreen>
  );
}
