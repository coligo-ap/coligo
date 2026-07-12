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
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createBareClient } from "@supabase/supabase-js";

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
  /** false = la RPC a ÉCHOUÉ : ne PAS en déduire « pas de PIN » (l'UI ne doit
   *  jamais proposer de re-créer un PIN sur une simple erreur réseau). */
  known: boolean;
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
    known: res?.ok === true,
  };
}

/**
 * Définit le PIN (création) ou le CHANGE — l'ancien PIN est alors OBLIGATOIRE
 * (mig 0360 : un PIN existant ne s'écrase jamais sans preuve ; mêmes compteurs
 * anti-bruteforce que la vérification). Le journal est écrit par la SQL.
 */
export async function setWalletPin(
  pin: string,
  currentPin?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await callRpc<JsonOk>("coligo_pay_set_pin", {
    p_pin: pin,
    p_current_pin: currentPin ?? null,
  });
  if (res?.ok) return { ok: true };
  return { ok: false, error: res?.error ?? "unknown" };
}

// ─── PIN oublié : preuve par email (code OTP) puis reset service_role ───────

const RESET_MAX_SENDS_PER_HOUR = 4;
const RESET_MIN_SECONDS_BETWEEN_SENDS = 60;

type Throttle = {
  fails: number;
  lock_level: number;
  locked_until: string | null;
  sends_window: string | null;
  sends_count: number;
  updated_at: string;
};

function lockedMinutes(t: Pick<Throttle, "locked_until"> | null): number {
  if (!t?.locked_until) return 0;
  const ms = new Date(t.locked_until).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/**
 * Envoie un code de vérification à l'EMAIL DU COMPTE (jamais choisi par le
 * client). Anti-abus : 60 s entre envois, 4 envois/heure (+ limites Supabase).
 */
export async function requestPinResetCode(): Promise<
  { ok: true; email: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "no_session" };

  // Réservé aux clients (le PIN Coligo Pay est un objet client).
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { ok: false, error: "not_customer" };

  const admin = createAdminClient();
  // tenant-scope-ok : ligne de throttle du user de LA session courante.
  const { data: th } = (await admin
    .from("pin_reset_throttle" as never)
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()) as { data: Throttle | null };

  const mins = lockedMinutes(th);
  if (mins > 0) return { ok: false, error: `locked:${mins}` };

  const now = Date.now();
  const windowStart = th?.sends_window
    ? new Date(th.sends_window).getTime()
    : 0;
  const inWindow = now - windowStart < 3600_000;
  const sends = inWindow ? (th?.sends_count ?? 0) : 0;
  if (inWindow && sends >= RESET_MAX_SENDS_PER_HOUR) {
    return { ok: false, error: "too_many_sends" };
  }
  if (
    th?.updated_at &&
    inWindow &&
    sends > 0 &&
    now - new Date(th.updated_at).getTime() <
      RESET_MIN_SECONDS_BETWEEN_SENDS * 1000
  ) {
    return { ok: false, error: "wait" };
  }

  // Client Supabase ISOLÉ (pas de cookies) : l'OTP envoyé ne touche pas la
  // session en cours. shouldCreateUser:false → jamais de création de compte.
  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { error } = await bare.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });
  if (error) {
    console.error("[coligo-pay] envoi code reset PIN:", error.message);
    return {
      ok: false,
      error: error.message.toLowerCase().includes("rate")
        ? "too_many_sends"
        : "send_failed",
    };
  }

  await admin.from("pin_reset_throttle" as never).upsert({
    user_id: user.id,
    sends_window: inWindow
      ? (th?.sends_window ?? new Date(now).toISOString())
      : new Date(now).toISOString(),
    sends_count: sends + 1,
    updated_at: new Date(now).toISOString(),
  } as never);

  return { ok: true, email: user.email };
}

/**
 * Valide le code reçu par email puis pose le NOUVEAU PIN. La preuve de l'email
 * est vérifiée par Supabase (verifyOtp) ; le reset passe par la fonction
 * service_role (jamais appelable par le client). 3 codes faux → 10 puis 20 min.
 */
export async function resetPinWithEmailCode(input: {
  code: string;
  newPin: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = (input.code ?? "").replace(/\D/g, "");
  const newPin = (input.newPin ?? "").trim();
  if (!/^\d{4}$/.test(newPin)) return { ok: false, error: "invalid_pin" };
  if (code.length < 6) return { ok: false, error: "bad_code" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "no_session" };

  const admin = createAdminClient();
  // tenant-scope-ok : ligne de throttle du user de LA session courante.
  const { data: th } = (await admin
    .from("pin_reset_throttle" as never)
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()) as { data: Throttle | null };
  const mins = lockedMinutes(th);
  if (mins > 0) return { ok: false, error: `locked:${mins}` };

  // Vérification du code sur un client ISOLÉ : la session créée par verifyOtp
  // est jetée, les cookies de la vraie session ne bougent pas.
  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { error } = await bare.auth.verifyOtp({
    email: user.email,
    token: code,
    type: "email",
  });
  if (error) {
    const fails = (th?.fails ?? 0) + 1;
    if (fails >= 3) {
      const lock_level = (th?.lock_level ?? 0) + 1;
      const minutes = lock_level <= 1 ? 10 : 20;
      await admin.from("pin_reset_throttle" as never).upsert({
        user_id: user.id,
        fails: 0,
        lock_level,
        locked_until: new Date(Date.now() + minutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      } as never);
      return { ok: false, error: `locked:${minutes}` };
    }
    await admin.from("pin_reset_throttle" as never).upsert({
      user_id: user.id,
      fails,
      updated_at: new Date().toISOString(),
    } as never);
    return { ok: false, error: "bad_code" };
  }

  // Email prouvé → reset via la fonction réservée à service_role.
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  const { data, error: rpcErr } = await rpc("coligo_pay_service_reset_pin", {
    p_user_id: user.id,
    p_new_pin: newPin,
  });
  const res = data as JsonOk | null;
  if (rpcErr || !res?.ok) {
    console.error(
      "[coligo-pay] service_reset_pin:",
      rpcErr?.message ?? res?.error
    );
    return { ok: false, error: res?.error ?? "unknown" };
  }

  // Succès → on efface le throttle.
  await admin
    .from("pin_reset_throttle" as never)
    .delete()
    .eq("user_id", user.id);
  return { ok: true };
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

/** Exécute un transfert P2P : handle + montant + PIN + idempotency key + note. */
export async function executeTransfer(input: {
  handle: string;
  amountDa: number;
  pin: string;
  clientOperationId: string;
  note?: string | null;
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
    p_note: input.note ?? null,
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

export type RecipientHit =
  | { ok: true; handle: string; name: string }
  | { ok: false; error: string };

/** Recherche un bénéficiaire par téléphone exact ou @handle exact. */
export async function searchRecipient(query: string): Promise<RecipientHit> {
  const q = query.trim();
  if (q.length < 4) return { ok: false, error: "too_short" };
  const res = await callRpc<{
    ok: boolean;
    error?: string;
    handle?: string;
    name?: string;
  }>("coligo_pay_search_recipient", { p_query: q });
  if (res?.ok && res.handle) {
    return { ok: true, handle: res.handle, name: res.name ?? "" };
  }
  return { ok: false, error: res?.error ?? "not_found" };
}

export type RecentRecipient = { handle: string; name: string };

/** Bénéficiaires récents (à qui le client a déjà envoyé). */
export async function getRecentRecipients(): Promise<RecentRecipient[]> {
  const res = await callRpc<{ handle: string; name: string }[]>(
    "coligo_pay_recent_recipients",
    { p_limit: 8 }
  );
  return Array.isArray(res)
    ? res
        .filter((r) => r && r.handle)
        .map((r) => ({ handle: r.handle, name: r.name ?? "" }))
    : [];
}
