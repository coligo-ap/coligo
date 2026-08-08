"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, X } from "lucide-react";
import { resolveDriverRefundClaim } from "@/app/admin/actions";
import { formatDA } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Réclamations d'avance no-show (mig 0160). Le livreur a avancé l'argent de la
 * commande au commerçant au pickup ; le client n'a pas répondu. Le support
 * valide le remboursement en choisissant le sort de la marchandise — ou refuse
 * (suspicion d'abus). L'historique par livreur (compteur) aide à repérer les
 * fraudes répétées.
 */

export type RefundClaimRow = {
  id: string;
  order_id: string;
  advance_da: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  goods_decision: "return_to_merchant" | "driver_keeps" | "give_away" | null;
  admin_note: string | null;
  created_at: string;
  order_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_claims_count: number;
  merchant_name: string | null;
  customer_noshow_count: number | null;
};

const DECISION_LABEL: Record<string, string> = {
  return_to_merchant: "Retour au commerçant (il rend l'avance en main propre)",
  driver_keeps: "Le livreur garde la commande (Coligo rembourse)",
  give_away: "Donner la commande (Coligo rembourse)",
};

export function AdminRefundClaims({ rows }: { rows: RefundClaimRow[] }) {
  const pending = rows.filter((r) => r.status === "pending");
  const resolved = rows.filter((r) => r.status !== "pending");

  if (rows.length === 0) {
    return (
      <p className="text-muted border-border rounded-md border border-dashed p-4 text-sm">
        Aucune réclamation d&apos;avance no-show.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map((r) => (
        <PendingClaim key={r.id} row={r} />
      ))}
      {resolved.length > 0 && (
        <details>
          <summary className="text-muted hover:text-foreground cursor-pointer text-sm font-medium select-none">
            Traitées ({resolved.length})
          </summary>
          <div className="mt-2 space-y-2">
            {resolved.map((r) => (
              <ResolvedClaim key={r.id} row={r} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ClaimHeader({ row }: { row: RefundClaimRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="bg-primary-50 text-primary-700 rounded-control flex size-8 items-center justify-center">
        <Banknote className="size-4" />
      </span>
      <span className="font-semibold tabular-nums">
        {formatDA(row.advance_da)}
      </span>
      <span className="text-muted text-xs">
        Cmd {row.order_number ?? row.order_id.slice(0, 8)} ·{" "}
        {row.merchant_name ?? "?"} ·{" "}
        {new Date(row.created_at).toLocaleDateString("fr-FR", {
          timeZone: "Africa/Algiers",
        })}
      </span>
      <span className="text-muted text-xs">
        Livreur : <strong>{row.driver_name ?? "?"}</strong>
        {row.driver_phone ? ` (${row.driver_phone})` : ""} ·{" "}
        {row.driver_claims_count} réclamation
        {row.driver_claims_count > 1 ? "s" : ""} au total
        {(row.customer_noshow_count ?? 0) > 0 &&
          ` · client : ${row.customer_noshow_count} no-show`}
      </span>
    </div>
  );
}

function PendingClaim({ row }: { row: RefundClaimRow }) {
  const router = useRouter();
  const [decision, setDecision] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await resolveDriverRefundClaim({
        claimId: row.id,
        approve,
        goodsDecision: approve
          ? (decision as "return_to_merchant" | "driver_keeps" | "give_away")
          : undefined,
        note: note || undefined,
      });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="border-warning-200 bg-warning-50/40 rounded-md border p-4">
      <ClaimHeader row={row} />
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          disabled={isPending}
          className="border-border-strong bg-surface rounded-control h-10 w-full border px-3 text-sm"
        >
          <option value="">— Sort de la marchandise —</option>
          {Object.entries(DECISION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => resolve(true)}
          disabled={isPending || !decision}
          className={cn(
            "bg-success-600 hover:bg-success-700 rounded-control inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold text-white",
            (isPending || !decision) && "opacity-50"
          )}
        >
          <Check className="size-4" /> Valider
        </button>
        <button
          type="button"
          onClick={() => resolve(false)}
          disabled={isPending}
          className="text-danger-600 border-danger-200 hover:bg-danger-50 rounded-control inline-flex h-10 items-center gap-1.5 border px-4 text-sm font-semibold disabled:opacity-50"
        >
          <X className="size-4" /> Refuser
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={isPending}
        placeholder="Note interne (visible du livreur si refus)"
        className="border-border-strong bg-surface rounded-control mt-2 h-10 w-full border px-3 text-sm"
      />
      {error && <p className="text-danger-600 mt-2 text-sm">{error}</p>}
    </div>
  );
}

function ResolvedClaim({ row }: { row: RefundClaimRow }) {
  return (
    <div className="border-border bg-surface rounded-md border p-3">
      <ClaimHeader row={row} />
      <p className="mt-1.5 text-xs">
        <span
          className={cn(
            "mr-2 rounded-full px-2 py-0.5 font-semibold",
            row.status === "approved"
              ? "bg-success-50 text-success-700"
              : "bg-danger-50 text-danger-700"
          )}
        >
          {row.status === "approved" ? "Validée" : "Refusée"}
        </span>
        {row.goods_decision && (
          <span className="text-muted">
            {DECISION_LABEL[row.goods_decision]}
          </span>
        )}
        {row.admin_note && (
          <span className="text-muted"> — {row.admin_note}</span>
        )}
      </p>
    </div>
  );
}
