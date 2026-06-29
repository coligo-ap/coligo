import { getPlatformSettings } from "@/lib/data/platform";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getPlatformSettings();
  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Taux de la plateforme
        </h1>
        <p className="text-muted mt-1 text-sm">
          Valeurs par défaut globales. Chaque commerçant peut les surcharger.
        </p>
      </header>
      {settings ? (
        <PlatformSettingsForm settings={settings} />
      ) : (
        <p className="text-danger-600 text-sm">
          Configuration introuvable (platform_settings vide).
        </p>
      )}
    </div>
  );
}
