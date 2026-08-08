import { Clock, XCircle } from "lucide-react";
import { AgentCard } from "@/components/admin/agents/agent-card";
import type { AgentRow } from "@/lib/data/admin-agents";

// Sous-page « Inscriptions » Agents Coligo Pay : demandes de partenariat à
// traiter + refusées. Chaque carte ouvre la fiche pour examiner le dossier,
// valider les pièces et approuver / refuser (AgentReviewPanel).
export function AgentsRegistrations({ agents }: { agents: AgentRow[] }) {
  const pending = agents.filter((a) => a.status === "pending");
  const rejected = agents.filter((a) => a.status === "rejected");

  return (
    <div className="space-y-6">
      <p className="text-muted text-sm">
        Demandes de partenariat des points de recharge. Ouvrez une demande pour
        examiner le dossier, valider les pièces, approuver et attribuer le badge
        vérifié.
      </p>

      <section className="border-warning-200 bg-warning-50/60 rounded-lg border p-4 lg:p-5">
        <h2 className="text-warning-900 mb-3 flex items-center gap-2 text-base font-bold">
          <Clock className="size-4" />
          Demandes à traiter ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted text-sm">
            Aucune demande en attente. Tout est traité ✅
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 && (
        <section className="border-border bg-surface rounded-lg border p-4 lg:p-5">
          <h2 className="text-foreground mb-3 flex items-center gap-2 text-base font-bold">
            <XCircle className="text-danger-500 size-4" />
            Refusées ({rejected.length})
          </h2>
          <ul className="space-y-2">
            {rejected.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
