"use server";

import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Retrait Coligo Pay (chauffeur / livreur) — demandes en libre-service.
// Le débit réel n'a lieu qu'au paiement par l'équipe Coligo (mig 0384) :
// écriture `payout` idempotente avec re-contrôle du solde.
// =============================================================================

export type MyWithdrawal = {
  id: string;
  method: "ccp" | "baridimob" | string;
  amountDa: number;
  destination: string;
  status: "pending" | "paid" | "rejected" | string;
  reviewNote: string | null;
  createdAt: string;
};

/** Mes demandes de retrait (suivi), la plus récente d'abord. */
export async function getMyWithdrawals(limit = 10): Promise<MyWithdrawal[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_operator_withdrawals", {
    p_limit: Math.min(50, Math.max(1, Math.round(limit))),
  });
  return (data ?? []).map((r) => ({
    id: r.id,
    method: r.method,
    amountDa: r.amount_da,
    destination: r.destination,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  }));
}

/** Dépose une demande de retrait (montant ≤ solde effectif, 1 en cours max). */
export async function requestOperatorWithdrawal(input: {
  method: "ccp" | "baridimob";
  amountDa: number;
  destination: string;
  destinationName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_operator_withdrawal", {
    p_method: input.method,
    p_amount_da: Math.round(input.amountDa),
    p_destination: input.destination.trim(),
    p_destination_name: input.destinationName?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
