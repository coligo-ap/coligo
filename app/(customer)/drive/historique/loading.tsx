import { DriveHistorySkeleton } from "@/components/customer/drive/drive-history";

/**
 * Frontière de chargement du segment : squelette affiché au tout premier accès
 * (RSC en vol). Réutilise le MÊME squelette que le chargeur client (TanStack
 * Query) pour une transition cohérente. Aux visites suivantes, le contenu vient
 * du cache client → ce squelette ne réapparaît pas.
 */
export default function DriveHistoriqueLoading() {
  return <DriveHistorySkeleton />;
}
