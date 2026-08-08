"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { CollapsibleSection } from "@/components/admin/shared/collapsible-section";
import { revokeFraudSanctionAction } from "@/app/admin/sanctions-actions";
import {
  FRAUD_ACTION_LABEL,
  type FraudActionType,
  type FraudActorKind,
} from "@/lib/fraud/model";

// =============================================================================
// FraudSanctionsPanel — la section « Sanctions anti-fraude » des fiches admin
// (client, livreur, chauffeur, commerçant) : chaque mesure ACTIVE se LÈVE ici
// (« Lever » par ligne, journalisé), plus de redirection vers le module.
//
// Deux modes d'alimentation :
//  - `sanctions` fourni par la fiche SERVEUR (livreur/chauffeur/client) ;
//  - `lazy` : le panneau se charge lui-même via /api/admin/fraud-sanctions
//    (annuaire commerçants — les lignes arrivent par « Voir plus »).
// Rendu NUL quand il n'y a rien d'actif : zéro bruit sur les comptes sains.
// =============================================================================

export type FraudSanctionRow = {
  id: string;
  action: string;
  source: "auto" | "admin";
  reason: string;
  created_at: string;
  expires_at: string | null;
};

const DATE = new Intl.DateTimeFormat("fr-DZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Algiers",
});
const fmt = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

export function FraudSanctionsPanel({
  kind,
  actorId,
  sanctions,
  lazy = false,
}: {
  kind: FraudActorKind;
  actorId: string;
  sanctions?: FraudSanctionRow[];
  lazy?: boolean;
}) {
  const [rows, setRows] = useState<FraudSanctionRow[]>(sanctions ?? []);

  // Mode serveur : suivre les props (router.refresh après une levée).
  useEffect(() => {
    if (!lazy) setRows(sanctions ?? []);
  }, [lazy, sanctions]);

  // Mode paresseux : un seul fetch au montage (les sanctions actives sont
  // rares — un compte sain ne coûte qu'une lecture indexée vide).
  useEffect(() => {
    if (!lazy) return;
    let alive = true;
    void fetch(
      `/api/admin/fraud-sanctions?kind=${kind}&id=${encodeURIComponent(actorId)}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : { sanctions: [] }))
      .then((d: { sanctions?: FraudSanctionRow[] }) => {
        if (alive) setRows(d.sanctions ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lazy, kind, actorId]);

  if (rows.length === 0) return null;

  return (
    <CollapsibleSection
      icon={<ShieldAlert className="size-4" />}
      title="Sanctions anti-fraude"
      count={rows.length}
      hint="Mesures actives posées par le moteur ou l'équipe — chaque levée est journalisée."
      defaultOpen
      tone="danger"
    >
      <ul className="mt-3 space-y-2">
        {rows.map((s) => (
          <SanctionRow
            key={s.id}
            kind={kind}
            actorId={actorId}
            sanction={s}
            onRevoked={
              lazy
                ? () => setRows((prev) => prev.filter((r) => r.id !== s.id))
                : undefined
            }
          />
        ))}
      </ul>
    </CollapsibleSection>
  );
}

/** Une sanction active = une ligne, avec SON bouton « Lever ». */
function SanctionRow({
  kind,
  actorId,
  sanction,
  onRevoked,
}: {
  kind: FraudActorKind;
  actorId: string;
  sanction: FraudSanctionRow;
  /** Mode paresseux : retire la ligne localement (pas de refresh serveur). */
  onRevoked?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label =
    FRAUD_ACTION_LABEL[sanction.action as FraudActionType] ?? sanction.action;

  async function revoke() {
    setError(null);
    const ok = await confirm({
      title: `Lever « ${label} » ?`,
      message:
        "La mesure est révoquée immédiatement et ses effets annulés. L'opération est journalisée.",
      confirmLabel: "Lever la sanction",
    });
    if (!ok) return;
    start(async () => {
      const res = await revokeFraudSanctionAction(kind, actorId, sanction.id);
      if (res.error) setError(res.error);
      else if (onRevoked) onRevoked();
      else router.refresh();
    });
  }

  return (
    <li className="border-danger-200 bg-danger-50/50 flex items-center gap-3 rounded-md border p-3">
      <span className="min-w-0 flex-1">
        <span className="text-foreground flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {label}
          <span className="bg-surface-2 text-muted text-caption rounded-full px-2 py-0.5 font-semibold">
            {sanction.source === "auto" ? "Moteur (auto)" : "Équipe"}
          </span>
        </span>
        <span className="text-muted text-label block">
          {sanction.reason} · {fmt(sanction.created_at)}
          {sanction.expires_at
            ? ` · expire le ${fmt(sanction.expires_at)}`
            : ""}
        </span>
        {error && (
          <span className="text-danger-700 text-label block font-medium">
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={revoke}
        disabled={pending}
        className="bg-success-600 hover:bg-success-700 rounded-control text-body-sm inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 font-bold text-white transition-colors disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        Lever
      </button>
    </li>
  );
}
