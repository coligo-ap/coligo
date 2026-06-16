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

type CreateRes = { ok?: true; walletId?: string; error?: string };

/**
 * Créer un NOUVEAU point de recharge officiel (géolocalisé). Si un mot de passe
 * est fourni, on crée AUSSI son compte de connexion (téléphone + mot de passe,
 * email synthétique @partners.coligo.local) → il accède à son portail /partenaire.
 */
export async function createPartner(input: {
  displayName: string;
  ownerName?: string;
  registreCommerce?: string;
  address?: string;
  phone?: string;
  hours?: string;
  lat?: number;
  lng?: number;
  loginPassword?: string;
}): Promise<CreateRes> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  if (!input.displayName.trim()) return { error: "Nom du commerce requis." };
  if (input.lat == null || input.lng == null)
    return { error: "Position sur la carte requise." };

  const admin = createAdminClient();

  // owner_id = id du compte auth si login demandé, sinon uuid (point passif).
  let ownerId = crypto.randomUUID();
  if (input.loginPassword?.trim()) {
    const digits = (input.phone ?? "").replace(/\D/g, "");
    if (digits.length < 6)
      return { error: "Téléphone requis pour créer un accès." };
    if (input.loginPassword.trim().length < 6)
      return { error: "Mot de passe trop court (6 caractères min)." };
    const email = `${digits}@partners.coligo.local`;
    const { data: created, error: authErr } = await admin.auth.admin.createUser(
      {
        email,
        password: input.loginPassword.trim(),
        email_confirm: true,
      }
    );
    if (authErr || !created?.user) {
      return {
        error: /registered|exists|duplicate/i.test(authErr?.message ?? "")
          ? "Ce téléphone a déjà un accès partenaire."
          : `Création du compte échouée : ${authErr?.message ?? "inconnu"}`,
      };
    }
    ownerId = created.user.id;
  }

  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )(t);

  const { data, error } = await from("operator_wallets")
    .insert({
      owner_type: "partner",
      owner_id: ownerId,
      is_partner: true,
      status: "active",
      display_name: input.displayName.trim(),
      owner_name: input.ownerName?.trim() || null,
      registre_commerce: input.registreCommerce?.trim() || null,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      hours: input.hours?.trim() || null,
      lat: input.lat,
      lng: input.lng,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true, walletId: data?.id };
}

/** Promouvoir un COMMERÇANT existant en point de recharge (réutilise sa fiche). */
export async function promoteMerchant(merchantId: string): Promise<CreateRes> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const q = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
            }>;
          };
        };
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            v: string
          ) => {
            select: (c: string) => {
              single: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )(t);

  const { data: m } = await q("merchants")
    .select("name, address, latitude, longitude, phone_public")
    .eq("id", merchantId)
    .maybeSingle();
  if (!m) return { error: "Commerçant introuvable." };
  if (m.latitude == null || m.longitude == null)
    return { error: "Ce commerçant n'a pas de position GPS." };

  const { data, error } = await q("operator_wallets")
    .update({
      is_partner: true,
      status: "active",
      display_name: m.name as string,
      address: (m.address as string) ?? null,
      phone: (m.phone_public as string) ?? null,
      lat: m.latitude as number,
      lng: m.longitude as number,
    })
    .eq("owner_id", merchantId)
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/admin/recharges");
  return { ok: true, walletId: data?.id };
}

/** Téléverse une pièce justificative d'un point (registre commerce, identité…). */
export async function uploadPartnerDoc(formData: FormData): Promise<Res> {
  if (!(await isSuperAdmin())) return DENIED;
  const walletId = String(formData.get("wallet_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const label = String(formData.get("label") ?? "");
  const file = formData.get("file");
  if (
    !walletId ||
    !["registre_commerce", "piece_identite", "autre"].includes(kind)
  )
    return { error: "Paramètres invalides." };
  if (!(file instanceof File) || file.size === 0)
    return { error: "Fichier requis." };
  if (file.size > 10 * 1024 * 1024)
    return { error: "Fichier trop volumineux (10 Mo max)." };

  const admin = createAdminClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${walletId}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await admin.storage
    .from("partner-docs")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: `Upload échoué : ${upErr.message}` };

  const from = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        insert: (
          v: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
      }
    )(t);
  const { error } = await from("partner_documents").insert({
    wallet_id: walletId,
    kind,
    url: path,
    label: label.trim() || null,
  });
  if (error) {
    await admin.storage.from("partner-docs").remove([path]);
    return { error: error.message };
  }
  revalidatePath("/admin/recharges");
  return { ok: true };
}

/** URL signée d'une pièce justificative d'un point. */
export async function signPartnerDocUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("partner-docs")
    .createSignedUrl(path, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
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
