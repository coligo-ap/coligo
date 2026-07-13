import { getIdvReviewQueue } from "@/lib/idv/admin-data";
import { IdvSubTabs } from "@/components/admin/idv/idv-sub-tabs";

export const dynamic = "force-dynamic";

// Coque du domaine Identité : sous-onglets Pilotage / Dossiers à vérifier,
// avec le compteur de dossiers en attente (l'admin voit la charge d'un coup
// d'œil). Le gate « confiance » est déjà posé par le layout du groupe.
export default async function IdentiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const queue = await getIdvReviewQueue(50);
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-3 lg:px-6">
          <IdvSubTabs pendingCount={queue.length} />
        </div>
      </div>
      {children}
    </div>
  );
}
