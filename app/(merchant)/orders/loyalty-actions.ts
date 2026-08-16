"use server";

/**
 * Server Actions FIDÉLITÉ de l'écran unifié « Valider » (SPEC-FIDELITE 2.x).
 *
 * Contrat d'erreurs, décidé avec le propriétaire :
 *  • réponse RPC résolue (même en échec métier) → retour STRUCTURÉ {ok, code}
 *    — l'UI mappe le code (lib/merchant/loyalty-messages), jamais de parsing ;
 *  • erreur de TRANSPORT (réseau/Postgres injoignable) → on THROW :
 *    - crédits : la file offline attrape et REJOUE (idempotent) ;
 *    - déductions : l'UI affiche « connexion requise » et n'autorise qu'un
 *      retry MANUEL avec le MÊME client_operation_id (jamais de retry auto).
 */

import { createClient } from "@/lib/supabase/server";
import { loyaltyErrorMessage } from "@/lib/merchant/loyalty-messages";

export type LoyaltyVoucherLite = {
  id: string;
  amount_da: number;
  expires_at: string;
};

export type LoyaltyProgress = {
  spent_da: number;
  threshold_da: number;
  reward_da: number;
  remaining_da: number;
} | null;

export type LoyaltySummary = {
  balance_da: number;
  available_da: number;
  vouchers: LoyaltyVoucherLite[];
  progress: LoyaltyProgress;
};

export type LoyaltyProgramLite = {
  enabled: boolean;
  earn_rate_pct: number | string;
  tier_threshold_da: number | null;
  tier_reward_da: number | null;
};

export type LoyaltyFiche = {
  ok: boolean;
  error?: string;
  kind?: "card" | "customer";
  linked?: boolean;
  label?: string;
  card_status?: string | null;
  will_activate?: boolean;
  voucher_deferred_da?: number;
  program?: LoyaltyProgramLite;
  summary?: LoyaltySummary;
};

export type LoyaltyCreditData = {
  already?: boolean;
  earned_da: number;
  capped?: boolean;
  activated?: boolean;
  vouchers_granted: LoyaltyVoucherLite[];
  voucher_deferred_da: number;
  purchase_da?: number;
  label?: string;
  summary?: LoyaltySummary;
};

/** Résultat compatible avec la plomberie de la file offline
 *  (`{error, success, stale}` — `stale:true` = définitif, ne pas rejouer). */
export type LoyaltyQueueResult = {
  error?: string;
  success?: string;
  stale?: boolean;
  code?: string;
  data?: LoyaltyCreditData;
};

export type LoyaltyRedeemResult = {
  ok: boolean;
  code?: string;
  already?: boolean;
  deducted_da?: number;
  available_da?: number;
  label?: string;
  summary?: LoyaltySummary;
};

export type LoyaltyOrderContext = {
  ok: boolean;
  code?: string;
  customer?: boolean;
  label?: string;
  payment_method?: string;
  already_credited?: boolean;
  can_credit?: boolean;
  credit_amount_da?: number;
  voucher_deferred_da?: number;
  program?: LoyaltyProgramLite;
  summary?: LoyaltySummary;
};

type RpcRow = Record<string, unknown>;

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcRow> {
  const supabase = await createClient();
  // RPC hors types générés → bind obligatoire (cf. reference_supabase_rpc_bind).
  const call = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: RpcRow | null; error: { message: string } | null }>;
  const { data, error } = await call(fn, args);
  if (error || !data) {
    // Transport / droits : on THROW — voir contrat en tête de fichier.
    throw new Error("network");
  }
  return data;
}

/** Fiche fidélité du porteur chez CE commerçant (lecture, vérifiée serveur). */
export async function resolveLoyaltyScan(
  identifier: string
): Promise<LoyaltyFiche> {
  return (await rpc("loyalty_resolve_scan", {
    p_identifier: identifier,
  })) as LoyaltyFiche;
}

/**
 * Crédit d'un achat (montant saisi en caisse). Utilisée EN DIRECT et par la
 * file offline — d'où le format {error, success, stale} + data.
 */
export async function creditLoyaltyResilient(
  identifier: string,
  purchaseDa: number,
  clientOperationId: string,
  orderId?: string | null
): Promise<LoyaltyQueueResult> {
  const data = await rpc("loyalty_credit", {
    p_identifier: identifier,
    p_purchase_da: purchaseDa,
    p_client_operation_id: clientOperationId,
    p_order_id: orderId ?? null,
  });
  if (data.ok !== true) {
    const code = String(data.error ?? "");
    // Échec MÉTIER = définitif : la file jette proprement (stale), pas de
    // retry inutile ×3.
    return { error: loyaltyErrorMessage(code), stale: true, code };
  }
  const d = data as unknown as LoyaltyCreditData & { ok: true };
  return {
    success: d.already
      ? "Crédit déjà appliqué."
      : `+${d.earned_da} DA de fidélité crédités.`,
    code: "ok",
    data: d,
  };
}

/** Déduction (bon OU cashback) — JAMAIS mise en file (anti double-dépense). */
export async function redeemLoyalty(
  identifier: string,
  clientOperationId: string,
  voucherId?: string | null,
  amountDa?: number | null
): Promise<LoyaltyRedeemResult> {
  const data = await rpc("loyalty_redeem", {
    p_identifier: identifier,
    p_client_operation_id: clientOperationId,
    p_voucher_id: voucherId ?? null,
    p_amount_da: amountDa ?? null,
  });
  if (data.ok !== true) {
    return {
      ok: false,
      code: String(data.error ?? ""),
      available_da:
        typeof data.available_da === "number" ? data.available_da : undefined,
    };
  }
  return data as unknown as LoyaltyRedeemResult & { ok: true };
}

/** Contexte fidélité d'une commande validée (cas combiné 2.4). */
export async function getLoyaltyOrderContext(
  orderId: string
): Promise<LoyaltyOrderContext> {
  try {
    const data = await rpc("loyalty_order_context", { p_order_id: orderId });
    if (data.ok !== true) {
      return { ok: false, code: String(data.error ?? "") };
    }
    return data as unknown as LoyaltyOrderContext & { ok: true };
  } catch {
    // Proposition non-critique : en cas de réseau instable on n'affiche rien
    // (le flux retrait, lui, est déjà terminé).
    return { ok: false, code: "network" };
  }
}

/** Crédit EN UN TAP sur la commande validée (montant repris côté serveur). */
export async function creditLoyaltyOrder(
  orderId: string,
  clientOperationId: string
): Promise<LoyaltyQueueResult> {
  const data = await rpc("loyalty_credit_order", {
    p_order_id: orderId,
    p_client_operation_id: clientOperationId,
  });
  if (data.ok !== true) {
    const code = String(data.error ?? "");
    return { error: loyaltyErrorMessage(code), stale: true, code };
  }
  const d = data as unknown as LoyaltyCreditData & { ok: true };
  return {
    success: d.already
      ? "Crédit déjà appliqué."
      : `+${d.earned_da} DA de fidélité crédités.`,
    code: "ok",
    data: d,
  };
}

/** Réduction proposée à l'encaissement d'une commande (2.4, sens inverse). */
export async function redeemLoyaltyOrder(
  orderId: string,
  clientOperationId: string,
  voucherId?: string | null,
  amountDa?: number | null
): Promise<LoyaltyRedeemResult> {
  const data = await rpc("loyalty_redeem_order", {
    p_order_id: orderId,
    p_client_operation_id: clientOperationId,
    p_voucher_id: voucherId ?? null,
    p_amount_da: amountDa ?? null,
  });
  if (data.ok !== true) {
    return {
      ok: false,
      code: String(data.error ?? ""),
      available_da:
        typeof data.available_da === "number" ? data.available_da : undefined,
    };
  }
  return data as unknown as LoyaltyRedeemResult & { ok: true };
}
