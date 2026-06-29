import { Car } from "lucide-react";
import { DriveConfig } from "@/components/admin/drive/drive-config";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Configuration du hub
// Coligo Drive (/admin/chauffeurs/config) via le composant partagé DriveConfig.
export default function AdminDrivePage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Config Drive</h1>
      </header>
      <DriveConfig />
    </div>
  );
}
