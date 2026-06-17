import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSignupForm } from "@/components/partner/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1400&q=80";

export default async function PartnerSignupPage() {
  // Déjà connecté en agent ? → direct à l'espace.
  const partner = await getCurrentPartner();
  if (partner) redirect("/partenaire");

  return (
    <AuthScreen
      navVariant="partner"
      installLabel="Installer l'application Agent"
      hero={{
        title: (
          <>
            Devenez Agent <br />
            Coligo Pay.
          </>
        ),
        subtitle:
          "Rejoignez le réseau des points de recharge Coligo et vendez du crédit.",
        features: [
          "Vendez du crédit à vos clients",
          "Gagnez sur chaque recharge",
          "Apparaissez sur la carte des points",
          "Un dossier validé par Coligo",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Demande de partenariat"
      cardSubtitle="Renseignez les informations de votre point de recharge. Coligo examinera votre dossier avant activation."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Déjà partenaire ?{" "}
          <Link
            href="/partenaire/login"
            className="text-primary-700 font-medium hover:underline"
          >
            Se connecter
          </Link>
        </div>
      }
    >
      <PartnerSignupForm />
    </AuthScreen>
  );
}
