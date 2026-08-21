"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { CARD_TEMPLATES } from "@/lib/loyalty/card-templates";
import { MB, validateUploadedFile } from "@/lib/security/file-validation";
import type { LoyaltyBatchRow } from "@/components/admin/merchants/loyalty-cards-console";

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
  preActivated?: boolean;
};

export async function adminCreateLoyaltyBatch(
  _prev: CreateBatchResult,
  formData: FormData
): Promise<CreateBatchResult> {
  if (!(await adminCan("commercants"))) {
    return { error: "Accès réservé au domaine Commerçants." };
  }
  // Commerçant OPTIONNEL (0459) : vide = lot GÉNÉRIQUE Coligo, valable chez
  // tous les commerçants (le cloisonnement vit dans le grand livre, pas sur la
  // carte). Pré-activation par défaut (0460) : utilisable en caisse sans compte.
  const merchantId = String(formData.get("merchant_id") ?? "").trim() || null;
  const quantity = Math.round(Number(formData.get("quantity") ?? 0));
  const templateKey = String(formData.get("template_key") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const printName = formData.get("print_merchant_name") === "1";
  const preActivated = formData.get("pre_activated") === "1";
  // Options d'impression v2 (0462) : titre, logo commerçant, mention basse.
  const printTitle = formData.get("print_title") === "1";
  const printLogo = formData.get("print_merchant_logo") === "1";
  const printValidAll = formData.get("print_valid_all") === "1";

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Quantité invalide." };
  }
  if (!CARD_TEMPLATES.some((t) => t.key === templateKey)) {
    return { error: "Choisissez un modèle de carte." };
  }

  // DESIGN PERSONNALISÉ (0461) : visuels recto/verso fournis par l'équipe
  // Coligo (fond perdu compris). Validation par MAGIC BYTES (jamais file.type),
  // PNG/JPG seuls (pdf-lib ne pose pas le WebP), puis upload dans le bucket
  // PRIVÉ `loyalty-card-art` — service_role APRÈS la garde adminCan (self-guard).
  let artRectoPath: string | null = null;
  let artVersoPath: string | null = null;
  const artRecto = formData.get("art_recto");
  const artVerso = formData.get("art_verso");
  const hasArt = (f: unknown): f is File => f instanceof File && f.size > 0;
  if (hasArt(artRecto) || hasArt(artVerso)) {
    if (!hasArt(artRecto)) {
      return { error: "Design personnalisé : le RECTO est obligatoire." };
    }
    const admin = createAdminClient();
    const folder = crypto.randomUUID();
    const uploadSide = async (
      file: File,
      side: "recto" | "verso"
    ): Promise<string | { error: string }> => {
      const v = await validateUploadedFile(file, {
        kind: "image",
        maxBytes: 8 * MB,
      });
      if (!v.ok) return { error: `Visuel ${side} : ${v.error}` };
      if (v.mime === "image/webp") {
        return {
          error: `Visuel ${side} : PNG ou JPG uniquement (impression).`,
        };
      }
      const path = `${folder}/${side}.${v.ext}`;
      const { error } = await admin.storage
        .from("loyalty-card-art")
        .upload(path, v.bytes, { contentType: v.mime });
      if (error) return { error: `Visuel ${side} : envoi impossible.` };
      return path;
    };
    const recto = await uploadSide(artRecto, "recto");
    if (typeof recto !== "string") return recto;
    artRectoPath = recto;
    if (hasArt(artVerso)) {
      const verso = await uploadSide(artVerso, "verso");
      if (typeof verso !== "string") return verso;
      artVersoPath = verso;
    }
  }

  try {
    const data = (await adminRpc("admin_loyalty_create_batch", {
      p_merchant_id: merchantId,
      p_quantity: quantity,
      p_template_key: templateKey,
      p_note: note,
      p_print_merchant_name: printName,
      p_activate_immediately: preActivated,
      p_art_recto_path: artRectoPath,
      p_art_verso_path: artVersoPath,
      p_print_title: printTitle,
      p_print_merchant_logo: printLogo,
      p_print_valid_all: printValidAll,
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
      preActivated: data.pre_activated === true,
    };
  } catch {
    return { error: "Création impossible. Réessayez." };
  }
}

/* ── Recherche commerçant (règle annuaires : échantillon 3 + ilike) + pilotage
     À DISTANCE du programme (mig 0458) ─────────────────────────────────── */

export type LoyaltyMerchantHit = {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  approved: boolean;
  has_program: boolean;
  program_enabled: boolean;
};

export async function adminSearchLoyaltyMerchants(
  query: string
): Promise<LoyaltyMerchantHit[]> {
  if (!(await adminCan("commercants"))) return [];
  try {
    const data = await adminRpc("admin_loyalty_search_merchants", {
      p_query: query,
    });
    return (Array.isArray(data) ? data : []) as LoyaltyMerchantHit[];
  } catch {
    return [];
  }
}

export type MerchantProgramValues = {
  enabled: boolean;
  earn_rate_pct: number | string;
  tier_threshold_da: number | null;
  tier_reward_da: number | null;
  voucher_validity_days: number;
  daily_credit_cap_da: number;
  link_bonus_da: number;
};

export async function adminGetMerchantLoyaltyProgram(
  merchantId: string
): Promise<{
  ok: boolean;
  merchant_name?: string;
  program?: MerchantProgramValues | null;
}> {
  if (!(await adminCan("commercants"))) return { ok: false };
  try {
    const data = (await adminRpc("admin_loyalty_get_merchant_program", {
      p_merchant_id: merchantId,
    })) as AdminRpcRow | null;
    if (!data || data.ok !== true) return { ok: false };
    return data as unknown as {
      ok: true;
      merchant_name: string;
      program: MerchantProgramValues | null;
    };
  } catch {
    return { ok: false };
  }
}

export type RemoteProgramResult = { error?: string; ok?: boolean };

function programBoundsError(
  code: string,
  extra: { min?: number | string; max?: number | string }
): string {
  const min = extra.min !== undefined ? String(extra.min) : "?";
  const max = extra.max !== undefined ? String(extra.max) : "?";
  switch (code) {
    case "bounds_earn_rate":
      return `Taux autorisé : ${min} % à ${max} %.`;
    case "bounds_tier_pair":
      return "Seuil ET récompense du palier (ou aucun des deux).";
    case "bounds_tier_threshold":
      return `Seuil de palier ≥ ${min} DA.`;
    case "bounds_tier_reward":
      return `Récompense de palier ≤ ${max} DA.`;
    case "bounds_validity":
      return `Validité entre ${min} et ${max} jours.`;
    case "bounds_daily_cap":
      return `Plafond quotidien ≤ ${max} DA.`;
    case "bounds_link_bonus":
      return `Bonus de liaison ≤ ${max} DA.`;
    case "not_found":
      return "Commerçant introuvable.";
    default:
      return "Réglage refusé. Vérifiez les valeurs.";
  }
}

/** Modification À DISTANCE du programme d'un commerçant (intervention rapide
 *  support). Toutes les valeurs sont soumises (jamais de patch partiel). */
export async function adminUpdateMerchantLoyaltyProgram(
  _prev: RemoteProgramResult,
  formData: FormData
): Promise<RemoteProgramResult> {
  if (!(await adminCan("commercants"))) {
    return { error: "Accès réservé au domaine Commerçants." };
  }
  const merchantId = String(formData.get("merchant_id") ?? "").trim();
  if (!merchantId) return { error: "Choisissez un commerçant." };

  const readInt = (k: string): number | null => {
    const raw = String(formData.get(k) ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const rawRate = String(formData.get("earn_rate_pct") ?? "").trim();
  const earnRate = rawRate === "" ? null : Number(rawRate.replace(",", "."));
  if (earnRate === null || !Number.isFinite(earnRate) || earnRate < 0) {
    return { error: "Taux de cashback invalide." };
  }
  const tierOn = formData.get("tier_on") === "1";
  const tierThreshold = tierOn ? readInt("tier_threshold_da") : null;
  const tierReward = tierOn ? readInt("tier_reward_da") : null;
  if (tierOn && (tierThreshold === null || tierReward === null)) {
    return { error: "Renseignez le seuil ET la récompense du palier." };
  }
  const validity = readInt("voucher_validity_days");
  const dailyCap = readInt("daily_credit_cap_da");
  const linkBonus = readInt("link_bonus_da") ?? 0;
  if (validity === null || dailyCap === null) {
    return { error: "Validité et plafond quotidien obligatoires." };
  }

  try {
    const data = (await adminRpc("admin_loyalty_update_merchant_program", {
      p_merchant_id: merchantId,
      p_enabled: formData.get("enabled") === "1",
      p_earn_rate_pct: earnRate,
      p_tier_threshold_da: tierThreshold,
      p_tier_reward_da: tierReward,
      p_voucher_validity_days: validity,
      p_daily_credit_cap_da: dailyCap,
      p_link_bonus_da: linkBonus,
    })) as AdminRpcRow | null;
    if (!data || data.ok !== true) {
      return {
        error: programBoundsError(
          String(data?.error ?? ""),
          (data ?? {}) as { min?: number; max?: number }
        ),
      };
    }
    revalidatePath("/admin/merchants/fidelite");
    return { ok: true };
  } catch {
    return { error: "Enregistrement impossible. Réessayez." };
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

/* ── LOTS : recherche + cycle de vie du LOT ENTIER (mig 0461) ──────────────
   Règle annuaires : liste courte par défaut, RECHERCHE serveur (ilike nom /
   note / n° de lot / « générique »). Bloquer/débloquer/supprimer passent par
   loyalty_card_transition carte par carte → chaque série désactivée reste
   TRACÉE dans loyalty_card_events + admin_audit_log. */

export async function adminListLoyaltyBatches(
  query: string
): Promise<LoyaltyBatchRow[]> {
  if (!(await adminCan("commercants"))) return [];
  try {
    const data = await adminRpc("admin_loyalty_batches", {
      p_limit: 20,
      p_query: query.trim() || null,
    });
    return (Array.isArray(data) ? data : []) as LoyaltyBatchRow[];
  } catch {
    return [];
  }
}

export type BatchOpResult = { ok: boolean; reason?: string; count?: number };

export async function adminBlockLoyaltyBatch(
  batchId: string,
  note?: string | null
): Promise<BatchOpResult> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_block_batch", {
      p_batch_id: batchId,
      p_note: note ?? null,
    })) as AdminRpcRow | null;
    if (data?.ok !== true) {
      return { ok: false, reason: String(data?.reason ?? "network") };
    }
    revalidatePath("/admin/merchants/fidelite");
    return { ok: true, count: Number(data.blocked ?? 0) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function adminUnblockLoyaltyBatch(
  batchId: string
): Promise<BatchOpResult> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_unblock_batch", {
      p_batch_id: batchId,
    })) as AdminRpcRow | null;
    if (data?.ok !== true) {
      return { ok: false, reason: String(data?.reason ?? "network") };
    }
    revalidatePath("/admin/merchants/fidelite");
    return { ok: true, count: Number(data.unblocked ?? 0) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Suppression DOUCE : cartes toutes bloquées + lot marqué supprimé — rien
 *  n'est effacé (journal, événements par carte et audit conservés). */
export async function adminDeleteLoyaltyBatch(
  batchId: string,
  note?: string | null
): Promise<BatchOpResult> {
  if (!(await adminCan("commercants")))
    return { ok: false, reason: "forbidden" };
  try {
    const data = (await adminRpc("admin_loyalty_delete_batch", {
      p_batch_id: batchId,
      p_note: note ?? null,
    })) as AdminRpcRow | null;
    if (data?.ok !== true) {
      return { ok: false, reason: String(data?.reason ?? "network") };
    }
    revalidatePath("/admin/merchants/fidelite");
    return { ok: true, count: Number(data.blocked ?? 0) };
  } catch {
    return { ok: false, reason: "network" };
  }
}
