"use server";

// =============================================================================
// Coligo Pay — paiement QR en magasin (argent réel). Server Actions client.
// =============================================================================
// ⚠️ Toute la sécurité (PIN hashé + lockout, token usage unique + expiry,
// idempotence, anti double-dépense, double-entrée) est dans les fonctions SQL
// SECURITY DEFINER (migration 0084). Ces actions ne font que relayer la session
// authentifiée vers ces fonctions — aucune logique d'argent côté Node.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

// Les fonctions 0084 ne sont pas (encore) dans les types générés : on relaie via
// le même garde-fou `as never` que lib/data/platform.ts pour le nom de RPC.
type Rpc = (
  name: string,
  args?: Record<string, unknown>
) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

async function callRpc<T>(
  name: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const { data, error } = await rpc(name, args);
  if (error) {
    console.error(`[coligo-pay] rpc ${name} error:`, error.message);
    return null;
  }
  return data as T;
}

type JsonOk = { ok: boolean; error?: string };

export type PinStatus = {
  hasPin: boolean;
  locked: boolean;
};

/** Statut du PIN Coligo Pay (défini ? verrouillé ?) — sans exposer le hash. */
export async function getWalletPinStatus(): Promise<PinStatus> {
  const res = await callRpc<{
    ok: boolean;
    has_pin?: boolean;
    locked?: boolean;
  }>("coligo_pay_pin_status");
  return {
    hasPin: !!res?.has_pin,
    locked: !!res?.locked,
  };
}

/** Définit / change le PIN (4 chiffres). */
export async function setWalletPin(
  pin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Sait-on déjà s'il existait un PIN ? → pour journaliser set vs changed.
  const before = await callRpc<{ has_pin?: boolean }>("coligo_pay_pin_status");
  const res = await callRpc<JsonOk>("coligo_pay_set_pin", { p_pin: pin });
  if (res?.ok) {
    await callRpc("coligo_log_security_event", {
      p_event: before?.has_pin ? "pin_changed" : "pin_set",
      p_detail: null,
    });
    return { ok: true };
  }
  return { ok: false, error: res?.error ?? "unknown" };
}

/** Vérifie le PIN (déverrouillage de l'écran de paiement). */
export async function verifyWalletPin(
  pin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await callRpc<JsonOk>("coligo_pay_verify_pin", { p_pin: pin });
  if (res?.ok) return { ok: true };
  return { ok: false, error: res?.error ?? "wrong" };
}

export type ResolvedRequest =
  | { ok: true; merchantName: string; amountDa: number }
  | { ok: false; error: string };

/** Résout un token marchand (aperçu avant confirmation) — read-only. */
export async function resolvePayRequest(
  token: string
): Promise<ResolvedRequest> {
  const t = token.trim();
  if (t.length < 8) return { ok: false, error: "not_found" };
  const res = await callRpc<{
    ok: boolean;
    error?: string;
    merchant_name?: string;
    amount_da?: number;
  }>("coligo_pay_resolve_request", { p_token: t });
  if (res?.ok) {
    return {
      ok: true,
      merchantName: res.merchant_name ?? "",
      amountDa: res.amount_da ?? 0,
    };
  }
  return { ok: false, error: res?.error ?? "not_found" };
}

export type ExecutedPayment =
  | {
      ok: true;
      paymentId: string;
      merchantName: string;
      amountDa: number;
      createdAt: string;
    }
  | { ok: false; error: string };

/**
 * Exécute le paiement : PIN + token + idempotency key. Tout est validé et
 * atomique côté SQL (coligo_pay_execute).
 */
export async function executePayment(input: {
  token: string;
  pin: string;
  clientOperationId: string;
}): Promise<ExecutedPayment> {
  const res = await callRpc<{
    ok: boolean;
    error?: string;
    payment_id?: string;
    merchant_name?: string;
    amount_da?: number;
    created_at?: string;
  }>("coligo_pay_execute", {
    p_token: input.token.trim(),
    p_pin: input.pin,
    p_client_operation_id: input.clientOperationId,
  });
  if (res?.ok) {
    return {
      ok: true,
      paymentId: res.payment_id ?? "",
      merchantName: res.merchant_name ?? "",
      amountDa: res.amount_da ?? 0,
      createdAt: res.created_at ?? new Date().toISOString(),
    };
  }
  return { ok: false, error: res?.error ?? "unknown" };
}

// ─── Transfert P2P (boucle fermée Coligo Pay → Coligo Pay) ─────────────────

export type MyPayHandle = { handle: string; name: string } | null;

/** Mon handle de réception (génère un code stable au 1er appel). */
export async function getMyPayHandle(): Promise<MyPayHandle> {
  const res = await callRpc<{ ok: boolean; handle?: string; name?: string }>(
    "coligo_pay_my_handle"
  );
  if (res?.ok && res.handle) {
    return { handle: res.handle, name: res.name ?? "" };
  }
  return null;
}

export type ResolvedReceiver =
  | { ok: true; recipientName: string }
  | { ok: false; error: string };

/** Résout un bénéficiaire par son handle (aperçu avant transfert). */
export async function resolveReceiver(
  handle: string
): Promise<ResolvedReceiver> {
  const h = handle.trim();
  if (h.length < 4) return { ok: false, error: "not_found" };
  const res = await callRpc<{
    ok: boolean;
    error?: string;
    recipient_name?: string;
  }>("coligo_pay_resolve_receiver", { p_handle: h });
  if (res?.ok) return { ok: true, recipientName: res.recipient_name ?? "" };
  return { ok: false, error: res?.error ?? "not_found" };
}

export type ExecutedTransfer =
  | { ok: true; recipientName: string; amountDa: number }
  | { ok: false; error: string };

/** Exécute un transfert P2P : handle + montant + PIN + idempotency key. */
export async function executeTransfer(input: {
  handle: string;
  amountDa: number;
  pin: string;
  clientOperationId: string;
}): Promise<ExecutedTransfer> {
  const amount = Math.floor(Number(input.amountDa));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  const res = await callRpc<{
    ok: boolean;
    error?: string;
    recipient_name?: string;
    amount_da?: number;
  }>("coligo_pay_transfer", {
    p_handle: input.handle.trim(),
    p_amount_da: amount,
    p_pin: input.pin,
    p_client_operation_id: input.clientOperationId,
  });
  if (res?.ok) {
    return {
      ok: true,
      recipientName: res.recipient_name ?? "",
      amountDa: res.amount_da ?? amount,
    };
  }
  return { ok: false, error: res?.error ?? "unknown" };
}
