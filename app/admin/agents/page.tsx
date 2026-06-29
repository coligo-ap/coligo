import { AgentsListView } from "@/components/admin/agents/agents-list-view";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Agents du hub Coligo Pay &
// Finances (/admin/coligo-pay/agents) via le composant partagé AgentsListView.
export default function AdminAgentsPage() {
  return <AgentsListView />;
}
