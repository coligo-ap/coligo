import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { DriverLoginForm } from "@/components/driver/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=1400&q=80";

export default async function DriverLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: driver } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (driver) redirect("/driver");
  }

  return (
    <AuthScreen
      navVariant="driver"
      installLabel="Installer l'application Livreur"
      hero={{
        title: (
          <>
            Livrez et gagnez, <br />à votre rythme.
          </>
        ),
        subtitle: "L'application des livreurs partenaires de Coligo.",
        features: [
          "Recevez des courses près de vous",
          "Suivez vos gains en temps réel",
          "Choisissez votre zone de travail",
          "Des versements rapides et transparents",
        ],
        imageUrl: HERO_IMG,
      }}
      cardTitle="Connexion · espace livreur"
      cardSubtitle="Vos livraisons et vos gains."
      modeTabs={
        <AuthModeTabs
          mode="login"
          loginHref="/driver/login"
          signupHref="/driver/signup"
        />
      }
    >
      <Suspense fallback={null}>
        <DriverLoginForm />
      </Suspense>
    </AuthScreen>
  );
}
