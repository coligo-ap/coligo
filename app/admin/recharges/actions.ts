"use server";

import { revalidatePath } from "next/cache";
import { isSuperAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Res = { ok?: true; error?: string };

const DENIED: Res = { error: "Accès refusé." };

/** URL signée d'une preuve de recharge (bucket privé wallet-proofs). */
export async function signWalletProofUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("wallet-proofs")
    .createSignedUrl(path, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

/** Valider une demande de recharge manuelle → crédit (RPC self-guard admin). */
export async function approveTopup(requestId: string): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const supabase = await createClient(); // session admin → auth.uid() ok
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("approve_topup_request", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** Refuser une demande de recharge manuelle. */
export async function rejectTopup(
  requestId: string,
  note: string
): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("reject_topup_request", {
    p_request_id: requestId,
    p_note: note,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** Activer / désactiver l'enforcement global (operator_gating). */
export async function setOperatorGating(active: boolean): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const admin = createAdminClient();
  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            v: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )(t);
  const { error } = await from("feature_flags")
    .update({ status: active ? "active" : "hidden" })
    .eq("key", "operator_gating");
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Créer un point de recharge : promotion d'un opérateur (par tél) ou point autonome. */
export async function createPartner(input: {
  displayName: string;
  address?: string;
  phone?: string;
  hours?: string;
  lat?: number;
  lng?: number;
  promotePhone?: string;
}): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  if (!input.displayName.trim()) return { error: "Nom requis." };
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        insert: (
          v: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            v: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )(t);

  const fields = {
    is_partner: true,
    status: "active",
    display_name: input.displayName.trim(),
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    hours: input.hours?.trim() || null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };

  // Promotion d'un opérateur existant (livreur/chauffeur) par téléphone.
  if (input.promotePhone?.trim()) {
    const { data } = await rpc("find_operator_wallet_by_phone", {
      p_phone: input.promotePhone.trim(),
    });
    const row = (Array.isArray(data) ? data[0] : null) as {
      wallet_id: string;
    } | null;
    if (!row) return { error: "Aucun opérateur avec ce téléphone." };
    const { error } = await from("operator_wallets")
      .update(fields)
      .eq("id", row.wallet_id);
    if (error) return { error: error.message };
  } else {
    // Point autonome (apparaît sur la carte ; financé par l'admin).
    const { error } = await from("operator_wallets").insert({
      owner_type: "partner",
      owner_id: crypto.randomUUID(),
      ...fields,
    });
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** Activer / suspendre / désactiver un portefeuille. */
export async function setWalletStatus(
  walletId: string,
  status: "active" | "suspended" | "disabled"
): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const admin = createAdminClient();
  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            v: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )(t);
  const { error } = await from("operator_wallets")
    .update({ status })
    .eq("id", walletId);
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** Créditer un portefeuille (recharge manuelle directe / bonus / ajustement). */
export async function creditWallet(input: {
  walletId: string;
  amountDa: number;
  type: "topup_manual" | "bonus" | "adjustment";
  note: string;
}): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  if (!Number.isFinite(input.amountDa) || input.amountDa === 0)
    return { error: "Montant invalide." };
  const supabase = await createClient(); // session admin pour le self-guard
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("admin_operator_credit", {
    p_wallet_id: input.walletId,
    p_amount_da: Math.round(input.amountDa),
    p_type: input.type,
    p_note: input.note ?? "",
    p_op_id: `admin:${crypto.randomUUID()}`,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** Mettre à jour les seuils négatifs + plafonds (platform_settings). */
export async function updateThresholds(input: {
  driver: number;
  chauffeur: number;
  merchant: number;
  newDays: number;
  topupMax: number;
}): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const admin = createAdminClient();
  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            v: boolean
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )(t);
  const { error } = await from("platform_settings")
    .update({
      neg_threshold_driver_da: Math.max(0, Math.round(input.driver)),
      neg_threshold_chauffeur_da: Math.max(0, Math.round(input.chauffeur)),
      neg_threshold_merchant_da: Math.max(0, Math.round(input.merchant)),
      neg_threshold_new_days: Math.max(0, Math.round(input.newDays)),
      operator_topup_max_da: Math.max(0, Math.round(input.topupMax)),
    })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true };
}
