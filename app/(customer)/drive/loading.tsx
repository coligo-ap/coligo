import { DriveHomeSkeleton } from "@/components/customer/drive/drive-home-skeleton";

/**
 * Frontière de chargement du segment Drive : rend le MÊME squelette que
 * `DriveView` en attente de contexte (source unique
 * `drive-home-skeleton.tsx`) — barre du bas comprise, comme sur les autres
 * pages (`/drive` est `bare`, la nav du chrome se démonte à l'entrée : sans
 * elle ici, la barre « disparaissait » pendant le chargement).
 */
export default function DriveLoading() {
  return <DriveHomeSkeleton />;
}
