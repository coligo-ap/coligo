import { AgentsListView } from "@/components/admin/agents/agents-list-view";

export const dynamic = "force-dynamic";

// Onglet « Agents » du hub Coligo Pay & Finances (composant partagé avec la
// route transverse /admin/agents). Les cartes ouvrent la fiche /admin/agents/[id].
export default function FinancesAgentsTab() {
  return <AgentsListView />;
}
