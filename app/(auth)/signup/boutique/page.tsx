import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthScreen } from "@/components/shared/auth-screen";
import { ShopSignupWizard } from "@/components/merchant/shop-signup-wizard";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80";

/**
 * Complétion d'inscription commerçant après une connexion GOOGLE (portail
 * /login ou /signup, `intent=merchant`) : le compte auth existe déjà, il ne
 * manque que la boutique. Même formulaire que /signup, sans email/mot de passe.
 */
export default async function CompleteShopPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Boutique déjà créée → l'espace commerçant directement.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  return (
    <AuthScreen
      navVariant="merchant"
      installLabel="Installer l'application Commerçant"
      hero={{
        title: (
          <>
            Encore une étape.
            <br />
            Créez votre boutique.
          </>
        ),
        subtitle: "Votre compte Google est connecté — décrivez votre commerce.",
        features: [
          "Recevez vos commandes en direct",
          "Gérez votre catalogue et vos horaires",
          "Suivez votre chiffre d'affaires",
          "Récupérez vos paiements simplement",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Votre boutique"
      cardSubtitle="Une question à la fois, en 1 minute."
    >
      {/* Complétion étape par étape (style Bolt Food) — mêmes champs et même
          action serveur (`completeSocialSignup`), sans email/mot de passe. */}
      <ShopSignupWizard mode="google" />
    </AuthScreen>
  );
}
