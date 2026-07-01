"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

type Res = { ok?: true; error?: string };

const DENIED: Res = { error: "Accès refusé." };

/**
 * Traiter une demande de versement commerçant : approuver / payer / refuser.
 * « payer » débite le grand livre (RPC `admin_process_payout`, bypass-proof).
 */
export async function processPayout(
  payoutId: string,
  action: "approve" | "pay" | "reject"
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  const supabase = await createClient(); // session admin → auth.uid() pour la garde
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("admin_process_payout", {
    p_payout_id: payoutId,
    p_action: action,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/versements");
  return { ok: true };
}

/**
 * Verser (débit) depuis le portefeuille d'un partenaire. Idempotent via op_id ;
 * la RPC refuse un solde insuffisant.
 */
export async function recordPartnerPayout(input: {
  walletId: string;
  amountDa: number;
  note: string;
}): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  if (!Number.isFinite(input.amountDa) || input.amountDa <= 0)
    return { error: "Montant invalide." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("admin_operator_payout", {
    p_wallet_id: input.walletId,
    p_amount_da: Math.round(input.amountDa),
    p_note: input.note ?? "",
    p_op_id: `admin-payout:${crypto.randomUUID()}`,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/versements");
  return { ok: true };
}
