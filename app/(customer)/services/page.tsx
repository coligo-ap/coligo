import { cookies } from "next/headers";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getEffectiveFlags, isVisible } from "@/lib/data/feature-flags";
import { listPublicMerchants } from "@/lib/data/merchants-public";
import {
  LOCATION_COOKIE,
  parseLocationCookie,
} from "@/lib/customer/location-cookie";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { ServicesHub } from "@/components/customer/services-hub";

export const dynamic = "force-dynamic";

// HUB DE DÉMARRAGE de l'app — réplique de la maquette « Photo v2 accueil »
// (barre « Où va-t-on ? », grille de tuiles illustrées, cartes photos « Autour
// de toi »). Les APK atterrissent ici via /api/start/client
// (APP_LANDING_CLIENT=/services, changeable sans rebuild). Page PUBLIQUE : les
// tuiles s'adaptent à la session et aux feature flags.
export const metadata = {
  title: "Coligo — Trajets, courses, repas et fidélité en Algérie",
  description:
    "Choisis ton service : trajets, supérettes et alimentation, fast-food et restaurants, carte de fidélité — et les espaces partenaires Coligo.",
  alternates: { canonical: "/services" },
};

export default async function ServicesHubPage() {
  const [customer, flags, cookieStore] = await Promise.all([
    getCurrentCustomerFull(),
    getEffectiveFlags(),
    cookies(),
  ]);

  // « Autour de toi » = commerces PROCHES, JAMAIS tout l'annuaire. La position
  // vient du cookie miroir de la position live du navigateur (écrit par
  // writeStoredLocation), sinon de l'adresse enregistrée du client. Sans
  // position ni zone : aucune carte au premier rendu — le composant relancera
  // la requête dès que le navigateur connaîtra la position exacte.
  const cookieLoc = parseLocationCookie(
    cookieStore.get(LOCATION_COOKIE)?.value
  );
  const latitude = cookieLoc?.lat ?? customer?.latitude ?? null;
  const longitude = cookieLoc?.lng ?? customer?.longitude ?? null;
  const wilaya = cookieLoc?.wilaya ?? customer?.default_wilaya_code ?? null;
  const commune = cookieLoc?.commune ?? customer?.default_commune ?? null;
  const hasCoords = latitude != null && longitude != null;

  const merchants =
    hasCoords || wilaya || commune
      ? await listPublicMerchants({
          // Avec coordonnées : filtre par RAYON réel (RPC merchants_nearby) et
          // tri du plus proche au plus loin. Sinon, repli sur la zone déclarée.
          latitude,
          longitude,
          wilaya_code: hasCoords ? null : wilaya,
          commune: hasCoords ? null : commune,
          limit: 12,
        }).catch(() => [])
      : [];

  const nearby = merchants
    .filter((m) => m.cover_url)
    .slice(0, 6)
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
