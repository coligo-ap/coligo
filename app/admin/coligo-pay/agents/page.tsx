import { AgentsDirectoryView } from "@/components/admin/agents/agents-directory-view";

export const dynamic = "force-dynamic";

// Onglet « Agents » du hub Coligo Pay & Finances : annuaire des agents actifs
// (recherche + pagination). Les demandes se valident dans l'onglet « Inscriptions ».
export default function FinancesAgentsTab() {
  return <AgentsDirectoryView />;
}
