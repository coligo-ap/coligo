import { RidesExplorer } from "@/components/admin/drive/rides-explorer";
import { StuckRidesPanel } from "@/components/admin/drive/stuck-rides-panel";
import { searchAdminRides } from "@/lib/data/admin-rides";
import {
  buildRideFilters,
  RIDES_PAGE_SIZE,
  type RidesSearchParams,
} from "@/lib/data/admin-rides-params";
import { getStuckRides } from "@/app/admin/drive/actions";

export const dynamic = "force-dynamic";

/**
 * Onglet « Courses » du hub Coligo Drive : courses BLOQUÉES à trancher en tête
 * (cible des alertes) + recherche complète (client, chauffeur, statut,
 * paiement, période — RPC admin_search_rides 0345). Chaque ligne ouvre la
 * fiche course (détails, historique, actions).
 */
export default async function AdminRidesPage({
  searchParams,
}: {
  searchParams: Promise<RidesSearchParams>;
}) {
  const sp = await searchParams;
  const { filters, explorer, page } = buildRideFilters(sp);
  const [{ rows, total }, stuckRides] = await Promise.all([
    searchAdminRides(filters),
    getStuckRides(),
  ]);

  return (
    <div className="space-y-4">
      {/* Cible des alertes courses bloquées / recherches carte expirées
          (?focus=…) : le panneau de tête, où elles se tranchent. */}
      <div
        data-alert-focus="rides_stuck_active rides_searching_card_expired"
        className="rounded-lg"
      >
        <StuckRidesPanel rides={stuckRides} />
      </div>
      <RidesExplorer
        rows={rows}
        total={total}
        page={page}
        pageSize={RIDES_PAGE_SIZE}
        filters={explorer}
      />
    </div>
  );
}
