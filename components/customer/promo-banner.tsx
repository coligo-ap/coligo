import { PromoBannerClient } from "@/components/customer/promo-banner-client";
import type { PromoBanner as PromoBannerData } from "@/lib/data/promo-banners";

/**
 * Emplacement bannière promo sur l'accueil — VOLONTAIREMENT VIDE par défaut.
 *
 * Au lancement, aucune bannière n'est codée en dur. Les promotions seront des
 * CAMPAGNES pilotées par le super-admin (périmètre plateforme / catégorie /
 * commerce ; conditions ; financeur plateforme ou commerçant ; actif/inactif).
 * Cette gestion est une tâche backend séparée.
 *
 * Ici, on ne fait qu'afficher CONDITIONNELLEMENT : tant qu'aucune campagne
 * active ne concerne ce contexte, le composant ne rend RIEN (pas de bloc vide).
 * Le jour où le super-admin active une campagne (table `promo_banners` /
 * future table de campagnes), elle apparaît sans toucher au front.
 */
export function PromoBanner({
  banners,
  geoFallback = false,
}: {
  banners: PromoBannerData[];
  /** Visiteur sans position connue du serveur (anon) → re-filtrage par zone
   *  côté client via la géoloc/localStorage. */
  geoFallback?: boolean;
}) {
  return <PromoBannerClient initial={banners} geoFallback={geoFallback} />;
}
