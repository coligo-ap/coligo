import { Car } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDomain } from "@/lib/auth/admin";
import { DriveHubTabs } from "@/components/admin/drive/drive-hub-tabs";

export const dynamic = "force-dynamic";

// Hub Coligo Drive : regroupe Chauffeurs / Inscriptions / Configuration Drive /
// Paramètres & zones en onglets. Scopé au route group (hub) : la fiche chauffeur
// [id] reste hors hub. Le badge « Inscriptions » = dossiers à valider. Gate
// super-admin via app/admin/layout.tsx.
export default async function DriveHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("drive");
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select("id, is_verified, is_blocked, submitted_at");
  const pendingCount = (data ?? []).filter(
    (c) => !c.is_verified && !c.is_blocked && c.submitted_at
  ).length;

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Coligo Drive</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <DriveHubTabs pendingCount={pendingCount} />
      </div>
      {children}
    </div>
  );
}
