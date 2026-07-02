import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { DriverInfoSection } from "@/components/driver/profile/driver-info-section";
import { PartnerBackHeader } from "@/components/shared/partner-ui";

export const dynamic = "force-dynamic";

/**
 * SOUS-PAGE « Mes documents » du compte livreur — PARITÉ /chauffeur/documents :
 * le dossier complet (véhicule, pièces + scans, méthode de versement, demandes
 * de modification) vit désormais dans sa propre page, ouverte depuis la ligne
 * « Documents » du Compte (plus de sections dépliées dans le compte).
 * Le contenu lourd (URLs signées des scans) est streamé via <Suspense>.
 */
export default async function DriverDocumentsPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader
        href="/driver/parametres"
        title="Mes documents"
        subtitle="Véhicule · pièces · versement"
      />
      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-[14px]"
                style={{ background: "var(--d-soft)" }}
              />
            ))}
          </div>
        }
      >
        <DriverInfoSection driverId={driver.id} verified={driver.is_verified} />
      </Suspense>
    </DriverShell>
  );
}
