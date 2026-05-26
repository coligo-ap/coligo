import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DriverLoginForm } from "@/components/driver/login-form";

export const dynamic = "force-dynamic";

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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Espace livreur</h1>
        <p className="text-muted text-sm">
          Connecte-toi avec ton téléphone pour accéder à tes livraisons.
        </p>
      </header>
      <DriverLoginForm />
      <p className="text-muted text-sm">
        Nouveau livreur ?{" "}
        <Link href="/driver/signup" className="text-primary-600 underline">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}
