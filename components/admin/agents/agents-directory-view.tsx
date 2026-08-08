import { searchAgents } from "@/lib/data/admin-agents";
import { AgentsDirectory } from "@/components/admin/agents/agents-directory";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

// Vue annuaire des Agents Coligo Pay (agents actifs, recherche + « Voir plus »)
// + compte de versement plateforme. Partagée entre la route transverse
// /admin/agents et l'onglet Agents du hub Coligo Pay (/admin/coligo-pay/agents).
export async function AgentsDirectoryView() {
  // 3 agents seulement : la recherche et « Voir plus » chargent la suite à la
  // demande — inutile de rapatrier tout l'annuaire pour l'afficher.
  const { rows, total } = await searchAgents({ limit: 3 });
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-foreground text-xl font-bold">Agents Coligo Pay</h1>
        <p className="text-muted mt-0.5 text-sm">
          Annuaire des points de recharge partenaires. Les nouvelles demandes de
          partenariat se valident dans l&apos;onglet « Inscriptions ».
        </p>
      </header>
      {/* Cible de l'alerte « agents à valider (pièces) » (?focus=…). */}
      <div data-alert-focus="partner_docs_pending" className="rounded-lg">
        <AgentsDirectory initialAgents={rows} initialTotal={total} />
      </div>
      <ModulePaymentAccount scope="partner" />
    </div>
  );
}
