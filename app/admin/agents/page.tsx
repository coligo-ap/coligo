import { requireAdminDomain } from "@/lib/auth/admin";
import { AgentsDirectoryView } from "@/components/admin/agents/agents-directory-view";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même annuaire que l'onglet Agents du hub Coligo
// Pay & Finances (/admin/coligo-pay/agents). Hors route-group → gate de domaine ici.
export default async function AdminAgentsPage() {
  await requireAdminDomain("finances");
  return <AgentsDirectoryView />;
}
