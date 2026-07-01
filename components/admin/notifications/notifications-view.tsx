import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { PushBroadcastForm } from "@/components/admin/push-broadcast-form";

// =============================================================================
// Vue Notifications push — partagée entre la route transverse
// /admin/notifications et l'onglet Notifications du hub Marketing
// (/admin/marketing/notifications). Les compteurs = appareils enregistrés
// (table device_tokens, natif + web). Gate super-admin via le layout /admin ET
// re-gardé ici (service_role) car vue « partagée » (mémoïsé, coût réseau nul).
// =============================================================================
export async function NotificationsView() {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data: rows } = await admin.from("device_tokens").select("role");

  const counts: Record<string, number> = {};
  for (const r of rows ?? []) {
    counts[r.role] = (counts[r.role] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Notifications push
        </h1>
        <p className="text-muted mt-1 text-sm">
          Envoie une notification libre aux appareils enregistrés (application
          Android et navigateur/PWA), par type d&apos;utilisateur.
        </p>
      </header>
      <PushBroadcastForm counts={counts} />
    </div>
  );
}
