import Link from "next/link";
import { ChevronRight, Store, UserRound } from "lucide-react";
import { AgentStatusBadge } from "@/components/admin/agents/agent-status-badge";
import type { AgentRow } from "@/lib/data/admin-agents";

// Carte d'un Agent Coligo Pay → ouvre la fiche /admin/agents/[id] (revue,
// validation des pièces, approuver/refuser via AgentReviewPanel).
export function AgentCard({ a }: { a: AgentRow }) {
  const loc = [a.commune, a.wilaya].filter(Boolean).join(", ");
  return (
    <li>
      <Link
        href={`/admin/agents/${a.id}`}
        className="border-border bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-[14px] border p-3 shadow-sm"
      >
        <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-semibold">
            {a.display_name ?? "Point sans nom"}
          </p>
          <p className="text-muted flex items-center gap-1.5 truncate text-xs">
            <UserRound className="size-3" />
            {a.owner_name ?? "—"}
            {a.phone ? ` · ${a.phone}` : ""}
            {loc ? ` · ${loc}` : ""}
          </p>
          <div className="mt-1">
            <AgentStatusBadge status={a.status} isVerified={a.is_verified} />
          </div>
        </div>
        <ChevronRight className="text-muted size-4 shrink-0" />
      </Link>
    </li>
  );
}
