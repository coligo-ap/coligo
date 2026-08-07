import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getFeatureFlag } from "@/lib/data/feature-flags";
import { CustomerFeatureBlocked } from "@/components/customer/feature-blocked-screen";
import { CarpoolView } from "@/components/customer/drive/carpool-view";

export const dynamic = "force-dynamic";

/**
 * COVOITURAGE PAR PLACES (mig 0443) : départs inter-wilayas publiés par les
 * chauffeurs, réservation à la place. Gated par les 3 kill-switch (drive,
 * drive_interwilaya, drive_carpool) — l'enforcement réel reste en DB.
 */
export default async function DriveCarpoolPage() {
  const [user, drive, inter, carpool] = await Promise.all([
    getAuthUser(),
    getFeatureFlag("drive"),
    getFeatureFlag("drive_interwilaya"),
    getFeatureFlag("drive_carpool"),
  ]);
  if (!user) redirect("/se-connecter?next=/drive/covoiturage");
  if (
    drive.status === "hidden" ||
    inter.status === "hidden" ||
    carpool.status === "hidden"
  ) {
    redirect("/drive");
  }
  const blocked = [drive, inter, carpool].find((f) => f.status !== "active");
  if (blocked) return <CustomerFeatureBlocked flag={blocked} withNav />;
  return <CarpoolView />;
}
