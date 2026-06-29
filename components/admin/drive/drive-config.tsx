import { redirect } from "next/navigation";
import { getDriveConfig, getDriveLearning } from "@/app/admin/drive/actions";
import { DriveConfigForm } from "@/components/admin/drive-config-form";
import { DriveLearningMonitor } from "@/components/admin/drive-learning-monitor";

// =============================================================================
// Vue « Config Drive » (monitor d'apprentissage + barème/seuils) — contenu
// seul, sans conteneur externe. Partagée entre la route transverse /admin/drive
// et l'onglet Configuration du hub Coligo Drive (/admin/chauffeurs/config).
// Aucune logique métier modifiée. Gate super-admin via getDriveConfig.
// =============================================================================
export async function DriveConfig() {
  const [cfg, learning] = await Promise.all([
    getDriveConfig(),
    getDriveLearning(),
  ]);
  if (!cfg) redirect("/admin");

  return (
    <div className="space-y-6">
      <DriveLearningMonitor initial={learning} />
      <DriveConfigForm initial={cfg} />
    </div>
  );
}
