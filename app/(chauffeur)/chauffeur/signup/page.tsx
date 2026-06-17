import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ChauffeurSignupForm } from "@/components/chauffeur/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Inscription chauffeur" };

const HERO_IMG =
  "https://images.unsplash.com/photo-1549924231-f129b911e442?auto=format&fit=crop&w=1400&q=80";

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

  return (
    <AuthScreen
      navVariant="chauffeur"
      installLabel="Installer l'application Chauffeur"
      hero={{
        title: (
          <>
            Devenez chauffeur <br />
            Coligo Drive.
          </>
        ),
        subtitle: "Inscrivez-vous et commencez à transporter des passagers.",
        features: [
          "Inscription rapide en quelques étapes",
          "Choisissez la gamme de votre véhicule",
          "Recevez des courses près de vous",
          "Suivez vos revenus en temps réel",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Créer mon compte"
      cardSubtitle="Renseignez vos informations pour créer votre compte chauffeur, puis ajoutez vos documents."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Déjà inscrit ?{" "}
          <Link
            href="/chauffeur/login"
            className="text-primary-700 font-medium hover:underline"
          >
            Se connecter
          </Link>
        </div>
      }
    >
      <ChauffeurSignupForm connectedPhone={connectedPhone} />
    </AuthScreen>
  );
}
