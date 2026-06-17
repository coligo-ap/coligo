import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { DriverLoginForm } from "@/components/driver/login-form";
import { AuthScreen } from "@/components/shared/auth-screen";

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
      cardTitle="Bonjour"
      cardSubtitle="Connectez-vous à votre espace livreur."
      footer={
        <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
          Nouveau livreur ?{" "}
          <Link
            href="/driver/signup"
            className="text-primary-700 font-medium hover:underline"
          >
            Créer un compte
          </Link>
        </div>
      }
    >
      <Suspense fallback={null}>
        <DriverLoginForm />
      </Suspense>
    </AuthScreen>
  );
}
