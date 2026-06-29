import { DriveConfig } from "@/components/admin/drive/drive-config";

export const dynamic = "force-dynamic";

// Onglet « Configuration Drive » du hub : monitor d'apprentissage + barème /
// seuils / cashback / CCP (composant partagé avec la route /admin/drive).
export default function DriveConfigTab() {
  return <DriveConfig />;
}
