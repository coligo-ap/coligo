import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverDashboardLive } from "@/components/driver/driver-dashboard-live";
import { DriverHomeMaquette } from "@/components/driver/home/driver-home-maquette";
import { DriverBottomNav } from "@/components/driver/driver-bottom-nav";

export const dynamic = "force-dynamic";

type Counts = {
  merchant_driver_id: string;
  merchant_id: string;
  merchant_name: string;
  express_enabled: boolean;
  tours_enabled: boolean;
  express_available: number;
  tour_pending: number;
};

/** Minuit du jour courant à Alger (UTC+1, pas de DST), en ISO UTC. */
function startOfTodayAlgiers(): string {
  const TZ = 1;
  const now = new Date();
  const local = new Date(now.getTime() + TZ * 3600_000);
  const midnightUTC = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  return new Date(midnightUTC - TZ * 3600_000).toISOString();
}

export default async function DriverHomePage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  // NB : le BLOCAGE (is_blocked) est géré dans le layout (écran dédié). Le GEL
  // (is_frozen) est SOUPLE : le livreur garde l'accès à ses pages, on lui
  // affiche juste un bandeau et la mise en ligne est refusée (cf. GoButton).

  // ===== Toutes les requêtes de l'accueil en PARALLÈLE =====
  // Avant : 5 awaits séquentiels (≈ somme des latences) → plusieurs secondes
  // sur mobile. Désormais : un seul Promise.all (≈ la plus lente). Aucune
  // dépendance entre elles (toutes filtrées par driver.id / début de journée).
  const since = startOfTodayAlgiers();
  const [
    { data: countsRaw },
    { data: linksRaw },
    { count: coursesToday },
    { data: payouts },
  ] = await Promise.all([
    // Compteurs de courses dispo par commerçant (RPC SECURITY DEFINER, trié).
    supabase.rpc("driver_delivery_counts"),
    // Liens du livreur — coordonnées (pins carte), commune, statuts.
    supabase
      .from("merchant_drivers")
      .select("id, status, merchants ( name, commune, latitude, longitude )")
      .eq("driver_id", driver.id),
    // Courses livrées aujourd'hui (compteur).
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_driver_id", driver.id)
      .gte("delivery_delivered_at", since),
    // Gains du jour (payouts du grand livre).
    supabase
      .from("delivery_ledger")
      .select("amount_da")
      .eq("driver_id", driver.id)
      .eq("type", "driver_payout")
      .gte("created_at", since),
  ]);
  const counts = (countsRaw ?? []) as Counts[];

  type MerchantInfo = {
    name: string;
    commune: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  type LinkRow = {
    id: string;
    status: string;
    merchants: MerchantInfo | MerchantInfo[] | null;
  };
  const links = (linksRaw ?? []) as LinkRow[];
  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  const linkById = new Map(links.map((l) => [l.id, l]));

  // Commerçants rejoints → lignes du sheet (pour les TOURNÉES) + pins carte.
  // L'Express ne dépend plus d'aucune inscription : seul le compteur Tournée
  // est pertinent par commerçant.
  const merchants = counts.map((c) => {
    const m = one(linkById.get(c.merchant_driver_id)?.merchants ?? null);
    return {
      mdId: c.merchant_driver_id,
      name: c.merchant_name,
      commune: m?.commune ?? null,
      pending: c.tour_pending,
      lat: m?.latitude ?? null,
      lng: m?.longitude ?? null,
    };
  });

  // Accès « Tournées » : montré sur l'accueil UNIQUEMENT si le livreur a rejoint
  // au moins un commerçant (sinon l'Express pur n'est pas pollué). Les demandes
  // en attente / accès retirés sont gérés dans le hub /driver/tournees.
  const joinedTourMerchants = links.filter(
    (l) => l.status === "active" || l.status === "pending"
  ).length;
  const tourPending = merchants.reduce((s, m) => s + (m.pending ?? 0), 0);
  const showToursEntry = joinedTourMerchants > 0;

  // Gains du jour (somme des payouts récupérés en parallèle ci-dessus).
  const earnedToday = (payouts ?? []).reduce(
    (s, r) => s + (r.amount_da ?? 0),
    0
  );

  return (
    // Pas de conteneur plein écran : la carte (persistante, montée dans le
    // layout) occupe le fond, et les contrôles flottent en îlots positionnés
    // au-dessus → la carte reste tactile dans les zones libres.
    <>
      {/* Refresh temps réel des compteurs + toast nouvelle course. */}
      <DriverDashboardLive />

      {/* La carte (MapLibre) est désormais montée dans le layout (persistante) :
          plus de re-création à chaque retour sur l'Accueil. Les options (zone de
          travail, tournées, compte…) sont regroupées dans le tiroir gauche du
          chrome maquette (bouton menu en haut à gauche) → accueil dégagé. */}

      {/* Chrome maquette (GO + radar + son + sheet + tiroir) en overlay. */}
      <DriverHomeMaquette
        driverId={driver.id}
        driverName={driver.full_name}
        isVerified={driver.is_verified}
        earnedToday={earnedToday}
        coursesToday={coursesToday ?? 0}
        showToursEntry={showToursEntry && !driver.is_frozen}
        tourPending={tourPending}
        isFrozen={driver.is_frozen}
        freezeReason={driver.freeze_reason}
      />

      {/* Réception Express (dispatch par zone) montée GLOBALEMENT dans le layout,
          pilotée par l'intention « en ligne » (store partagé). */}

      {/* Nav basse persistante — onglet « Accueil » actif. */}
      <DriverBottomNav />
    </>
  );
}
