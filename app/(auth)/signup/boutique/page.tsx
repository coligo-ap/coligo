import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { AuthScreen } from "@/components/shared/auth-screen";
import { ShopSignupWizard } from "@/components/merchant/shop-signup-wizard";

export const dynamic = "force-dynamic";

const HERO_IMG = "/heros/commercant.webp";

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

  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <AuthScreen
      navVariant="merchant"
      installLabel={tr(
        "Installer l'application Commerçant",
        "ثبّت تطبيق التاجر"
      )}
      hero={{
        title: isAr ? (
          <>
            خطوة أخيرة.
            <br />
            أنشئ متجرك.
          </>
        ) : (
          <>
            Encore une étape.
            <br />
            Créez votre boutique.
          </>
        ),
        subtitle: tr(
          "Votre compte Google est connecté — décrivez votre commerce.",
          "حساب Google متصل — صف متجرك."
        ),
        features: isAr
          ? [
              "استقبل طلباتك مباشرة",
              "أدر الكتالوج وأوقات العمل",
              "تابع رقم أعمالك",
              "استرجع مدفوعاتك بسهولة",
            ]
          : [
              "Recevez vos commandes en direct",
              "Gérez votre catalogue et vos horaires",
              "Suivez votre chiffre d'affaires",
              "Récupérez vos paiements simplement",
            ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr("Votre boutique", "متجرك")}
      cardSubtitle={tr(
        "Une question à la fois, en 1 minute.",
        "سؤال واحد في كل خطوة، في دقيقة."
      )}
    >
      {/* Complétion étape par étape (style Bolt Food) — mêmes champs et même
          action serveur (`completeSocialSignup`), sans email/mot de passe. */}
      <ShopSignupWizard mode="google" />
    </AuthScreen>
  );
}
