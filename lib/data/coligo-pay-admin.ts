import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Surveillance Coligo Pay (admin) — réconciliation + journal d'audit.
// =============================================================================
// Les fonctions 0087 ne sont pas dans database.types.ts généré : on cast le NOM
// (`as never`) en gardant l'appel méthode supabase.rpc(…) (binding `this`).
// Les fonctions sont gardées côté SQL par is_super_admin() — la page appelle
// aussi requireSuperAdmin() en amont (défense en profondeur).
// =============================================================================

export type ColigoPayOverview = {
  circulationDa: number;
  accountsWithBalance: number;
  rechargesCount: number;
  rechargesDa: number;
  merchantPaymentsCount: number;
  merchantPaymentsDa: number;
  merchantPaymentsCommissionDa: number;
  transfersCount: number;
  transfersDa: number;
  negativeBalances: number;
  unbalancedPayments: number;
  unbalancedTransfers: number;
  pinLockedNow: number;
};

export type ColigoPayAuditEntry = {
  at: string;
  kind: "payment" | "transfer" | "recharge";
  amountDa: number;
  commissionDa: number;
  fromName: string | null;
  toName: string | null;
  ref: string | null;
};

export async function getColigoPayOverview(): Promise<ColigoPayOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_coligo_pay_overview" as never
  );
  if (error || !data) return null;
  const d = data as unknown as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    circulationDa: n("circulation_da"),
    accountsWithBalance: n("accounts_with_balance"),
    rechargesCount: n("recharges_count"),
    rechargesDa: n("recharges_da"),
    merchantPaymentsCount: n("merchant_payments_count"),
    merchantPaymentsDa: n("merchant_payments_da"),
    merchantPaymentsCommissionDa: n("merchant_payments_commission_da"),
    transfersCount: n("transfers_count"),
    transfersDa: n("transfers_da"),
    negativeBalances: n("negative_balances"),
    unbalancedPayments: n("unbalanced_payments"),
    unbalancedTransfers: n("unbalanced_transfers"),
    pinLockedNow: n("pin_locked_now"),
  };
}

export type SecurityEvent = {
  at: string;
  event: "pin_set" | "pin_changed" | "email_changed" | "phone_changed" | string;
  who: string | null;
};

export async function getSecurityEvents(limit = 50): Promise<SecurityEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_security_events" as never,
    {
      p_limit: limit,
    } as never
  );
  if (error || !data) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    at: String(r.created_at ?? ""),
    event: String(r.event ?? ""),
    who: (r.who as string | null) ?? null,
  }));
}

export async function getColigoPayAudit(
  limit = 50
): Promise<ColigoPayAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_coligo_pay_audit" as never,
    {
      p_limit: limit,
    } as never
  );
  if (error || !data) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    at: String(r.at ?? ""),
    kind: (r.kind as ColigoPayAuditEntry["kind"]) ?? "payment",
    amountDa: Number(r.amount_da ?? 0),
    commissionDa: Number(r.commission_da ?? 0),
    fromName: (r.from_name as string | null) ?? null,
    toName: (r.to_name as string | null) ?? null,
    ref: (r.ref as string | null) ?? null,
  }));
}
