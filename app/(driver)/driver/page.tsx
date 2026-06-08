import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverDashboardLive } from "@/components/driver/driver-dashboard-live";
import { DriverHomeMap } from "@/components/driver/home/driver-home-map";
import { DriverHomeSheet } from "@/components/driver/home/driver-home-sheet";
import { DriverHomeTopbar } from "@/components/driver/home/driver-home-topbar";
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

  const firstName = driver.full_name.split(" ")[0];

  if (driver.is_frozen) {
    return (
      <div className="relative min-h-[100dvh] bg-[#f2f2f2]">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-lg font-bold text-[#0a0a0a]">Compte gelé</h1>
          <p className="text-sm font-medium text-[#757575]">
            Ton accès a été suspendu par Coligo. Contacte le support.
          </p>
        </div>
      </div>
    );
  }

  // Compteurs de courses dispo par commerçant (RPC SECURITY DEFINER, déjà trié).
  const { data: countsRaw } = await supabase.rpc("driver_delivery_counts");
  const counts = (countsRaw ?? []) as Counts[];

  // Tous les liens du livreur — pour les coordonnées (pins carte), la commune,
  // et les sections en attente / bloqué.
  const { data: linksRaw } = await supabase
    .from("merchant_drivers")
    .select("id, status, merchants ( name, commune, latitude, longitude )")
    .eq("driver_id", driver.id);

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

  const pins = merchants
    .filter((m) => m.lat != null && m.lng != null)
    .map((m) => ({ id: m.mdId, name: m.name, lat: m.lat!, lng: m.lng! }));

  // En attente / bloqué (fonctionnel, conservé).
  const pending = links
    .filter((l) => l.status === "pending")
    .map((l) => ({ id: l.id, name: one(l.merchants)?.name ?? "Commerçant" }));
  const blocked = links
    .filter((l) => l.status === "blocked")
    .map((l) => ({ id: l.id, name: one(l.merchants)?.name ?? "Commerçant" }));

  // ===== Stats du jour (données réelles) =====
  const since = startOfTodayAlgiers();

  const { count: coursesToday } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_driver_id", driver.id)
    .gte("delivery_delivered_at", since);

  const { data: payouts } = await supabase
    .from("delivery_ledger")
    .select("amount_da")
    .eq("driver_id", driver.id)
    .eq("type", "driver_payout")
    .gte("created_at", since);
  const earnedToday = (payouts ?? []).reduce(
    (s, r) => s + (r.amount_da ?? 0),
    0
  );

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[#f2f2f2]">
      {/* Refresh temps réel des compteurs + toast nouvelle course. */}
      <DriverDashboardLive />

      <DriverHomeMap merchants={pins} />
      <DriverHomeTopbar />

      <DriverHomeSheet
        firstName={firstName}
        coursesToday={coursesToday ?? 0}
        earnedToday={earnedToday}
        merchants={merchants}
        pending={pending}
        blocked={blocked}
        bottomOffset={58}
      />

      {/* La réception Express (dispatch par zone) est montée GLOBALEMENT dans le
          layout livreur, pilotée par l'intention « en ligne » (store partagé). */}

      {/* Nav basse — onglet « Courses » actif sur l'accueil. */}
      <DriverBottomNav />
    </div>
  );
}
