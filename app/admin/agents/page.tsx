import { AgentsDirectoryView } from "@/components/admin/agents/agents-directory-view";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même annuaire que l'onglet Agents du hub Coligo
// Pay & Finances (/admin/coligo-pay/agents).
export default function AdminAgentsPage() {
  return <AgentsDirectoryView />;
}
