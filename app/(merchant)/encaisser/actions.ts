"use server";

// =============================================================================
// Coligo Pay — encaissement marchand par QR (argent réel). Server Actions.
// =============================================================================
// Le commerçant saisit un montant → on génère un TOKEN opaque (serveur, non
// devinable), à usage unique et qui expire (15 min). Le QR encode ce token.
// Le client le scanne, confirme avec son PIN, et le paiement crédite le wallet
// marchand (vente − commission) — toute la logique d'argent est dans la fonction
// SQL coligo_pay_execute (migration 0084).
// =============================================================================

import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

type Rpc = (
  name: string,
  args?: Record<string, unknown>
) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

// Token base32 Crockford (sans I/L/O/U) — non ambigu, lisible si saisi à la main.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function generateToken(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  // Préfixe lisible pour distinguer un code Coligo Pay.
  return "CP" + out; // 14 chars (>= 12 requis côté SQL)
}

export type CreateRequestResult =
  | { ok: true; token: string; requestId: string; expiresAt: string }
  | { ok: false; error: string };

const MIN_PAY_DA = 10;
const MAX_PAY_DA = 1_000_000;

export async function createPayRequest(
  amountDa: number
): Promise<CreateRequestResult> {
  const amount = Math.floor(Number(amountDa));
  if (!Number.isFinite(amount) || amount < MIN_PAY_DA) {
    return { ok: false, error: "below_min" };
  }
  if (amount > MAX_PAY_DA) {
    return { ok: false, error: "above_max" };
  }

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const token = generateToken();

  const { data, error } = await rpc("coligo_pay_create_request", {
    p_token: token,
    p_amount_da: amount,
    p_ttl_seconds: 900,
  });
  if (error) {
    console.error("[encaisser] create_request error:", error.message);
    return { ok: false, error: "server" };
  }
  const res = data as {
    ok: boolean;
    error?: string;
    id?: string;
    expires_at?: string;
  };
  if (!res?.ok) return { ok: false, error: res?.error ?? "server" };
  return {
    ok: true,
    token,
    requestId: res.id ?? "",
    expiresAt: res.expires_at ?? "",
  };
}

export type RequestStatus =
  | { status: "active" | "cancelled" }
  | { status: "consumed"; amountDa: number; paidAt: string | null };

// Accès lecture aux tables 0084 (absentes des types générés) — cast typé.
type LooseSelect<T> = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: T | null; error: unknown }>;
      };
    };
  };
};

/** Polling commerçant : la demande a-t-elle été payée ? (RLS = ses demandes). */
export async function getPayRequestStatus(
  requestId: string
): Promise<RequestStatus | null> {
  const supabase = await createClient();
  const reqClient = supabase as unknown as LooseSelect<{
    status: string;
    amount_da: number;
    payment_id: string | null;
  }>;
  const { data, error } = await reqClient
    .from("coligo_pay_requests")
    .select("status, amount_da, payment_id")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data) return null;

  if (data.status === "consumed") {
    let paidAt: string | null = null;
    if (data.payment_id) {
      const payClient = supabase as unknown as LooseSelect<{
        created_at: string;
      }>;
      const { data: pay } = await payClient
        .from("coligo_pay_payments")
        .select("created_at")
        .eq("id", data.payment_id)
        .maybeSingle();
      paidAt = pay?.created_at ?? null;
    }
    return { status: "consumed", amountDa: data.amount_da, paidAt };
  }
  return { status: data.status as "active" | "cancelled" };
}
