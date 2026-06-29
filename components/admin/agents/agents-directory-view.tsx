import { loadAgents } from "@/lib/data/admin-agents";
import { AgentsDirectory } from "@/components/admin/agents/agents-directory";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

// Vue annuaire des Agents Coligo Pay (agents actifs, recherche + pagination) +
// compte de versement plateforme. Partagée entre la route transverse
// /admin/agents et l'onglet Agents du hub Coligo Pay (/admin/coligo-pay/agents).
export async function AgentsDirectoryView() {
  const agents = await loadAgents();
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-foreground text-xl font-bold">Agents Coligo Pay</h1>
        <p className="text-muted mt-0.5 text-sm">
          Annuaire des points de recharge partenaires. Les nouvelles demandes de
          partenariat se valident dans l&apos;onglet « Inscriptions ».
        </p>
      </header>
      <AgentsDirectory agents={agents} />
      <ModulePaymentAccount scope="partner" />
    </div>
  );
}
