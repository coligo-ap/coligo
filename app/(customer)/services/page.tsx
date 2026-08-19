import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getEffectiveFlags, isVisible } from "@/lib/data/feature-flags";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { ServicesHub } from "@/components/customer/services-hub";

export const dynamic = "force-dynamic";

// HUB DE DÉMARRAGE de l'app (style Uber/Yassir) — les APK atterrissent ici
// via /api/start/client (APP_LANDING_CLIENT=/services, changeable sans
// rebuild). Page PUBLIQUE : seule l'auth est attendue côté serveur (règle
// perf), les cartes s'adaptent à la session et aux feature flags.
export const metadata = {
  title: "Coligo — Trajets, courses, repas et fidélité en Algérie",
  description:
    "Choisis ton service : trajets, supérettes et alimentation, fast-food et restaurants, carte de fidélité — et les espaces partenaires Coligo.",
  alternates: { canonical: "/services" },
};

export default async function ServicesHubPage() {
  const [customer, flags] = await Promise.all([
    getCurrentCustomerFull(),
    getEffectiveFlags(),
  ]);

  const firstName = customer?.full_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <>
      {/* Détection auto de la position dès que la permission est accordée
          (même mécanique que la home — resync au retour au premier plan). */}
      <LocationAutoDetect />
      <ServicesHub
        isAuth={!!customer}
        firstName={firstName}
        driveVisible={isVisible(flags.drive)}
        loyaltyVisible={isVisible(flags.loyalty)}
      />
    </>
  );
}
