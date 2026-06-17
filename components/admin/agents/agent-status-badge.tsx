import { BadgeCheck, Clock } from "lucide-react";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "⏳ En attente", cls: "bg-warning-50 text-warning-700" },
  active: { label: "✓ Actif", cls: "bg-success-50 text-success-700" },
  rejected: { label: "Refusé", cls: "bg-danger-50 text-danger-700" },
  suspended: { label: "Suspendu", cls: "bg-warning-50 text-warning-700" },
  disabled: { label: "Désactivé", cls: "bg-danger-50 text-danger-700" },
};

const PILL =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold";

/** Badge d'état d'un Agent Coligo Pay (statut du dossier + vérification). */
export function AgentStatusBadge({
  status,
  isVerified,
}: {
  status: string;
  isVerified?: boolean | null;
}) {
  const st = STATUS_META[status] ?? {
    label: status,
    cls: "bg-surface-2 text-muted",
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`${PILL} ${st.cls}`}>{st.label}</span>
      {isVerified ? (
        <span className={`${PILL} bg-success-50 text-success-700`}>
          <BadgeCheck className="size-3.5" />
          Vérifié
        </span>
      ) : (
        <span className={`${PILL} bg-warning-50 text-warning-700`}>
          <Clock className="size-3.5" />
          Non vérifié
        </span>
      )}
    </span>
  );
}
