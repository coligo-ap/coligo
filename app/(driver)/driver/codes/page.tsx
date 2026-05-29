import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DriverSubmitCodeForm } from "@/components/driver/submit-code-form";
import { DriverShell } from "@/components/driver/driver-shell";
import { getCurrentDriver } from "@/lib/auth/driver";

export const dynamic = "force-dynamic";

export default async function DriverSubmitCodePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si pas connecté : on envoie le livreur sur /driver/signup en préservant
  // le code (?code=XXX), pour qu'il puisse signup puis revenir ici.
  if (!user) {
    const next = code
      ? `/driver/codes?code=${encodeURIComponent(code)}`
      : "/driver/codes";
    redirect(`/driver/signup?next=${encodeURIComponent(next)}`);
  }

  const driver = await getCurrentDriver();
  const firstName = driver?.full_name.split(" ")[0];

  return (
    <DriverShell driverFirstName={firstName}>
      <div className="space-y-5">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
        >
          <ArrowLeft className="size-4" />
          Accueil
        </Link>
        <header className="space-y-1">
          <h1 className="text-[22px] font-extrabold tracking-tight text-[#0a0a0a]">
            Rejoindre un commerçant
          </h1>
          <p className="text-sm font-medium text-[#757575]">
            {code
              ? "Vérifie le code pré-rempli et valide pour envoyer ta demande."
              : "Saisis le code de référence que le commerçant t'a partagé."}
          </p>
        </header>
        <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_16px_rgba(0,0,0,.06)]">
          <Suspense fallback={null}>
            <DriverSubmitCodeForm />
          </Suspense>
        </div>
      </div>
    </DriverShell>
  );
}
