import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { DriverSubmitCodeForm } from "@/components/driver/submit-code-form";
import { DriverShell } from "@/components/driver/driver-shell";
import { getCurrentDriver } from "@/lib/auth/driver";
import { PartnerBackHeader } from "@/components/shared/partner-ui";

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
      <PartnerBackHeader
        href="/driver"
        title="Rejoindre un commerçant"
        subtitle={
          code
            ? "Vérifie le code pré-rempli et valide pour envoyer ta demande."
            : "Saisis le code de référence que le commerçant t'a partagé."
        }
      />
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <Suspense fallback={null}>
          <DriverSubmitCodeForm />
        </Suspense>
      </div>
    </DriverShell>
  );
}
