import Link from "next/link";
import { ChauffeurLoginForm } from "@/components/chauffeur/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Espace chauffeur" };

const HERO_IMG =
  "https://images.unsplash.com/photo-1549924231-f129b911e442?auto=format&fit=crop&w=1400&q=80";

export default function ChauffeurLoginPage() {
  return (
    <AuthScreen
      navVariant="chauffeur"
      installLabel="Installer l'application Chauffeur"
      hero={{
        title: (
          <>
            Conduisez avec <br />
            Coligo Drive.
          </>
        ),
        subtitle: "L'application des chauffeurs VTC partenaires de Coligo.",
        features: [
          "Recevez des demandes de course",
          "Négociez et acceptez en un geste",
          "Suivez vos revenus en temps réel",
          "Gérez vos documents simplement",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Bonjour"
      cardSubtitle="Connectez-vous à votre espace chauffeur."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Nouveau chauffeur ?{" "}
          <Link
            href="/chauffeur/signup"
            className="text-primary-700 font-medium hover:underline"
          >
            Créer un compte
          </Link>
        </div>
      }
    >
      <ChauffeurLoginForm />
    </AuthScreen>
  );
}
