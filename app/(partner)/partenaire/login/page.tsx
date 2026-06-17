import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerLoginForm } from "@/components/partner/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1400&q=80";

export default async function PartnerLoginPage() {
  const partner = await getCurrentPartner();
  if (partner) redirect("/partenaire");

  return (
    <AuthScreen
      navVariant="partner"
      installLabel="Installer l'application Agent"
      hero={{
        title: (
          <>
            Vendez du crédit <br />
            Coligo Pay.
          </>
        ),
        subtitle: "L'espace des Agents Coligo Pay (points de recharge).",
        features: [
          "Rechargez les portefeuilles de vos clients",
          "Suivez votre solde et vos ventes",
          "Encaissez vos commissions simplement",
          "Un support dédié aux partenaires",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Espace Agent Coligo Pay"
      cardSubtitle="Connectez-vous pour gérer votre solde et vos ventes de crédit."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Pas encore Agent Coligo Pay ?{" "}
          <Link
            href="/partenaire/signup"
            className="text-primary-700 font-medium hover:underline"
          >
            Devenir partenaire
          </Link>
        </div>
      }
    >
      <PartnerLoginForm />
    </AuthScreen>
  );
}
