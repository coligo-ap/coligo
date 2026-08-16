"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/auth/admin";
import { CARD_TEMPLATES } from "@/lib/loyalty/card-templates";

export type LoyaltyBoundsResult = { error?: string; ok?: boolean };

function readNum(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Bornes plateforme du programme de fidélité : toute config commerçant hors
 * de ces bornes devient impossible (RPC + trigger DB). SESSION admin, jamais
 * service_role : admin_can() lit l'email du JWT.
 */
export async function updateLoyaltyBounds(
  _prev: LoyaltyBoundsResult,
  formData: FormData
): Promise<LoyaltyBoundsResult> {
  if (!(await adminCan("commercants"))) {
    return { error: "Accès réservé au domaine Commerçants." };
  }

  const vals = {
    p_min_earn_rate_pct: readNum(formData, "min_earn_rate_pct"),
    p_max_earn_rate_pct: readNum(formData, "max_earn_rate_pct"),
    p_min_tier_threshold_da: readNum(formData, "min_tier_threshold_da"),
    p_max_tier_reward_da: readNum(formData, "max_tier_reward_da"),
    p_max_daily_credit_cap_da: readNum(formData, "max_daily_credit_cap_da"),
    p_max_link_bonus_da: readNum(formData, "max_link_bonus_da"),
    p_min_voucher_validity_days: readNum(formData, "min_voucher_validity_days"),
    p_max_voucher_validity_days: readNum(formData, "max_voucher_validity_days"),
    p_max_purchase_per_credit_da: readNum(
      formData,
      "max_purchase_per_credit_da"
    ),
    p_max_batch_quantity: readNum(formData, "max_batch_quantity"),
  };
  if (Object.values(vals).some((v) => v === null)) {
    return { error: "Toutes les bornes sont obligatoires." };
  }

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: { ok?: boolean; reason?: string } | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await rpc("admin_loyalty_update_settings", vals);

  if (error) return { error: "Enregistrement impossible. Réessayez." };
  if (!data?.ok) {
    return {
      error:
        data?.reason === "bad_bounds"
          ? "Bornes incohérentes (min > max, valeur nulle ou négative)."
          : "Réglage refusé.",
    };
  }

  revalidatePath("/admin/merchants/fidelite");
  return { ok: true };
}

/* ───────────────────────── LOTS DE CARTES (Phase 4) ────────────────────────
   Le super-admin a TOUTE la main : création des lots (modèle visuel choisi
   parmi CARD_TEMPLATES), journal, PDF retéléchargeable à tout moment
   (/api/pdf/cartes-fidelite/<batchId>), recherche/blocage/transfert de carte.
   Session admin, jamais service_role (admin_can lit l'email du JWT). */

type AdminRpcRow = Record<string, unknown>;

async function adminRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<AdminRpcRow | AdminRpcRow[] | null> {
  const supabase = await createClient();
  const call = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: AdminRpcRow | AdminRpcRow[] | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await call(fn, args);
  if (error) throw new Error("network");
  return data;
}

export type CreateBatchResult = {
  error?: string;
  ok?: boolean;
  batchId?: string;
  quantity?: number;
};

export async function adminCreateLoyaltyBatch(
  _prev: CreateBatchResult,
  formData: FormData
): Promise<CreateBatchResult> {
  if (!(await adminCan("commercants"))) {
    return { error: "Accès réservé au domaine Commerçants." };
  }
  const merchantId = String(formData.get("merchant_id") ?? "").trim();
  const quantity = Math.round(Number(formData.get("quantity") ?? 0));
  const templateKey = String(formData.get("template_key") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!merchantId) return { error: "Choisissez un commerçant." };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Quantité invalide." };
  }
  if (!CARD_TEMPLATES.some((t) => t.key === templateKey)) {
    return { error: "Choisissez un modèle de carte." };
  }

  try {
    const data = (await adminRpc("admin_loyalty_create_batch", {
      p_merchant_id: merchantId,
      p_quantity: quantity,
      p_template_key: templateKey,
      p_note: note,
    })) as AdminRpcRow | null;
    if (!data || data.ok !== true) {
      const reason = String(data?.reason ?? "");
      if (reason === "bad_quantity") {
        return {
          error: `Quantité hors bornes (max ${String(data?.max ?? "?")} cartes par lot).`,
        };
      }
      if (reason === "merchant_not_found") {
        return { error: "Commerçant introuvable." };
      }
      return { error: "Création du lot refusée." };
    }
    revalidatePath("/admin/merchants/fidelite");
    return {
      ok: true,
      batchId: String(data.batch_id),
      quantity: Number(data.quantity ?? quantity),
    };
  } catch {
    return { error: "Création impossible. Réessayez." };
  }
}

export type AdminCardLookup = {
  ok: boolean;
  reason?: string;
  card?: {
    id: string;
    card_code: string;
    status: "printed" | "activated" | "linked" | "blocked";
    customer_id: string | null;
    batch_id: string | null;
    merchant_id: string | null;
    created_at: string;
    activated_at: string | null;
    linked_at: string | null;
    blocked_at: string | null;
    blocked_reason: string | null;
  };
  accounts?: {
    merchant_name: string;
    balance_da: number;
    vouchers_da: number;
  }[];
  events?: {
    from: string | null;
    to: string;
    actor: string;
    note: string | null;
    at: string;
  }[];
};

export async function adminLookupLoyaltyCard(
  query: string
): Promise<AdminCardLookup> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_card_lookup", {
      p_query: query,
    })) as AdminRpcRow | null;
    if (!data || data.ok !== true) {
      return { ok: false, reason: String(data?.reason ?? "network") };
    }
    return data as unknown as AdminCardLookup & { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function adminBlockLoyaltyCard(
  cardId: string,
  note?: string | null
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_block_card", {
      p_card_id: cardId,
      p_note: note ?? null,
    })) as AdminRpcRow | null;
    return data?.ok === true
      ? { ok: true }
      : { ok: false, reason: String(data?.reason ?? "network") };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function adminUnblockLoyaltyCard(
  cardId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_unblock_card", {
      p_card_id: cardId,
    })) as AdminRpcRow | null;
    return data?.ok === true
      ? { ok: true }
      : { ok: false, reason: String(data?.reason ?? "network") };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type AdminTransferResult = {
  ok: boolean;
  reason?: string;
  moved?: { merchant_name: string; amount_da: number; vouchers: number }[];
};

export async function adminTransferLoyaltyCard(
  fromCardId: string,
  targetIdentifier: string,
  note?: string | null
): Promise<AdminTransferResult> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_transfer_card", {
      p_from_card_id: fromCardId,
      p_to_identifier: targetIdentifier,
      p_note: note ?? null,
    })) as AdminRpcRow | null;
    if (data?.ok !== true) {
      return { ok: false, reason: String(data?.reason ?? "network") };
    }
    return data as unknown as AdminTransferResult & { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}
