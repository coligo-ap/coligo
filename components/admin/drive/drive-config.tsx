import Link from "next/link";
import { CreditCard } from "lucide-react";
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
      <Link
        href="/admin/chauffeurs/abonnements"
        className="border-primary-200 bg-primary-50 text-primary-700 flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium"
      >
        <CreditCard className="size-4 shrink-0" />
        <span>
          Les <b>plans d’abonnement</b> (prix, commission, cashback, badge,
          ordre) se gèrent désormais dans l’onglet <b>Abonnements</b> — cette
          page ne configure que le barème et les seuils.
        </span>
      </Link>
      <DriveLearningMonitor initial={learning} />
      <DriveConfigForm initial={cfg} />
    </div>
  );
}
