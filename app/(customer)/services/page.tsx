import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getEffectiveFlags, isVisible } from "@/lib/data/feature-flags";
import { listPublicMerchants } from "@/lib/data/merchants-public";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { ServicesHub } from "@/components/customer/services-hub";

export const dynamic = "force-dynamic";

// HUB DE DÉMARRAGE de l'app — réplique du modèle Uber fourni (barre « Où
// va-t-on ? », grille de tuiles, cartes photos « Autour de toi »). Les APK
// atterrissent ici via /api/start/client (APP_LANDING_CLIENT=/services,
// changeable sans rebuild). Page PUBLIQUE : les tuiles s'adaptent à la
// session et aux feature flags.
export const metadata = {
  title: "Coligo — Trajets, courses, repas et fidélité en Algérie",
  description:
    "Choisis ton service : trajets, supérettes et alimentation, fast-food et restaurants, carte de fidélité — et les espaces partenaires Coligo.",
  alternates: { canonical: "/services" },
};

export default async function ServicesHubPage() {
  const [customer, flags, merchants] = await Promise.all([
    getCurrentCustomerFull(),
    getEffectiveFlags(),
    // Cartes photos « Autour de toi » : proximité réelle si la position est
    // connue (cookie), sinon l'annuaire public — jamais bloquant.
    listPublicMerchants({}).catch(() => []),
  ]);

  const nearby = merchants
    .filter((m) => m.cover_url)
    .slice(0, 8)
    .map((m) => ({
      slug: m.slug,
      name: m.name,
      cover_url: m.cover_url,
      city: m.city,
    }));

  return (
    <>
      {/* Détection auto de la position dès que la permission est accordée
          (même mécanique que la home — resync au retour au premier plan). */}
      <LocationAutoDetect />
      <ServicesHub
        isAuth={!!customer}
        driveVisible={isVisible(flags.drive)}
        loyaltyVisible={isVisible(flags.loyalty)}
        nearby={nearby}
      />
    </>
  );
}
