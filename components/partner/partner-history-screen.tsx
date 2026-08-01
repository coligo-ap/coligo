"use client";

import { useEffect, useState } from "react";
import { formatDA } from "@/lib/utils";
import {
  getMyWalletEntries,
  type MyWalletEntry,
} from "@/app/wallet/recharge-actions";

const ENTRY_LABEL: Record<string, string> = {
  topup_chargily: "Recharge carte",
  topup_manual: "Recharge validée",
  topup_partner: "Recharge reçue",
  recharge_sale: "Vente de crédit",
  bonus: "Bonus reçu",
  fee_debit: "Frais",
  adjustment: "Ajustement",
};

// =============================================================================
// SOUS-PAGE « HISTORIQUE » — toutes les opérations de l'agent.
//
// Sur l'accueil, la liste était tronquée et poussait le reste vers le bas.
// Ici elle a la place, avec un filtre par nature d'opération : un agent qui
// cherche « mes ventes du mois » n'a plus à faire défiler ses recharges.
// =============================================================================

export function PartnerHistoryScreen() {
  const [entries, setEntries] = useState<MyWalletEntry[] | null>(null);
  const [kind, setKind] = useState<"all" | "sale" | "topup" | "bonus">("all");

  useEffect(() => {
    void getMyWalletEntries().then(setEntries);
  }, []);

  const shown = (entries ?? []).filter((e) => {
    if (kind === "all") return true;
    if (kind === "sale") return e.type === "recharge_sale";
    if (kind === "bonus") return e.type === "bonus";
    return e.type.startsWith("topup_");
  });

  return (
    <div className="space-y-3">
      {/* Filtres — appliqués localement, réponse instantanée au tap. */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "Tout"],
            ["sale", "Ventes"],
            ["topup", "Recharges"],
            ["bonus", "Bonus"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setKind(id)}
            className={
              kind === id
                ? "border-primary-600 bg-primary-600 rounded-full border px-3 py-1 text-xs font-bold text-white"
                : "border-border text-muted rounded-full border px-3 py-1 text-xs font-bold"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="border-border bg-surface rounded-[16px] border p-4">
        {entries === null ? (
          <p className="text-muted text-sm">Chargement…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted text-sm">Aucune opération pour le moment.</p>
        ) : (
          <ul className="divide-border divide-y">
            {shown.map((e, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-foreground text-xs">
                  {ENTRY_LABEL[e.type] ?? e.type}
                  <span className="text-subtle block">
                    {new Date(e.createdAt).toLocaleDateString("fr-DZ")}
                  </span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${e.amountDa < 0 ? "text-danger-700" : "text-success-700"}`}
                >
                  {e.amountDa > 0 ? "+" : ""}
                  {formatDA(e.amountDa)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
