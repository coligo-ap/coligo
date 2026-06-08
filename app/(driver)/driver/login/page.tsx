import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Store, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DriverLoginForm } from "@/components/driver/login-form";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import { Logo } from "@/components/shared/logo";

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
    <div className="flex min-h-screen flex-col">
      <AuthNavBar variant="driver" />
      <main className="bg-surface-2 flex flex-1 items-start justify-center p-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            <Logo variant="amber" size="lg" />
          </div>

          <div className="border-border space-y-6 rounded-[14px] border bg-white p-6 shadow-sm">
            <header className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight">
                Espace livreur
              </h1>
              <p className="text-muted text-sm">
                Connecte-toi avec ton téléphone pour accéder à tes livraisons.
              </p>
            </header>

            <Suspense fallback={null}>
              <DriverLoginForm />
            </Suspense>

            <div className="border-border text-muted border-t pt-4 text-center text-sm">
              Nouveau livreur ?{" "}
              <Link
                href="/driver/signup"
                className="text-primary-700 font-medium hover:underline"
              >
                Créer un compte
              </Link>
            </div>

            <div className="border-border mt-2 grid grid-cols-2 gap-2 border-t pt-4 text-xs">
              <Link
                href="/login"
                className="border-border hover:bg-surface-2 inline-flex items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 font-medium"
              >
                <Store className="size-3.5" />
                Espace commerçant
              </Link>
              <Link
                href="/se-connecter"
                className="border-border hover:bg-surface-2 inline-flex items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 font-medium"
              >
                <UserIcon className="size-3.5" />
                Je suis client
              </Link>
            </div>
          </div>
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}
