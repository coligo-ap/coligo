import { ChauffeurLoginForm } from "@/components/chauffeur/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

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
      cardTitle="Connexion"
      cardSubtitle="Accédez à vos courses et à vos gains."
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
