import { loadAgents } from "@/lib/data/admin-agents";
import { AgentsRegistrations } from "@/components/admin/agents/agents-registrations";

export const dynamic = "force-dynamic";

// Onglet « Inscriptions » du hub Coligo Pay & Finances : demandes de partenariat
// des Agents Coligo Pay à valider.
export default async function FinancesRegistrationsTab() {
  const agents = await loadAgents();
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-bold">
          Inscriptions des Agents Coligo Pay
        </h1>
      </header>
      <AgentsRegistrations agents={agents} />
    </div>
  );
}
