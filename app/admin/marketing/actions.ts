"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// /admin/marketing — codes promo PLATEFORME (mig 0292) + bons d'achat (mig 0293).
// Gardé par isSuperAdmin(). CRUD des codes via service_role (bypass RLS, comme
// les bannières). Les RPC de bons (is_super_admin interne) sont appelées avec la
// SESSION ADMIN (createClient) pour que auth.uid() alimente le garde.
// =============================================================================

export type MarketingActionState = { error?: string; ok?: boolean };

// --- platform_promotions hors database.types.ts généré → accès casté. ---
type DbErr = { message: string } | null;
type Resp = Promise<{ data: unknown; error: DbErr }>;
type PromoBuilder = {
  insert: (v: Record<string, unknown>) => {
    select: (c: string) => {
      single: () => Promise<{ data: { id?: string } | null; error: DbErr }>;
    };
  };
  update: (v: Record<string, unknown>) => {
    eq: (c: string, v: unknown) => Resp;
  };
  delete: () => { eq: (c: string, v: unknown) => Resp };
};
function promoTable(admin: ReturnType<typeof createAdminClient>): PromoBuilder {
  return (admin.from as unknown as (n: string) => PromoBuilder)(
    "platform_promotions"
  );
}

async function audit(action: string, targetId: string | null, note?: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action,
      target_kind: "platform_promo",
      target_id: targetId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action */
  }
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Le code est requis.")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Lettres, chiffres, - et _ uniquement."),
  title_fr: z.string().trim().min(1, "Le titre est requis.").max(100),
  title_ar: z.string().trim().max(100),
  description_fr: z.string().trim().max(400),
  description_ar: z.string().trim().max(400),
  discount_kind: z.enum(["percent", "amount"]),
  discount_value: z.coerce.number().min(0),
  max_discount_da: z.coerce.number().int().positive().nullable(),
  min_subtotal_da: z.coerce.number().int().min(0).nullable(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  max_uses: z.coerce.number().int().positive().nullable(),
  max_uses_per_customer: z.coerce.number().int().positive().nullable(),
  online_only: z.boolean(),
  app_only: z.boolean(),
  audience: z.enum(["public", "targeted", "all"]),
  is_listed: z.boolean(),
  active: z.boolean(),
});

export type CodeInput = z.input<typeof codeSchema>;

function toRow(v: z.infer<typeof codeSchema>) {
  return {
    code: v.code.toUpperCase(),
    title_fr: v.title_fr,
    title_ar: v.title_ar || null,
    description_fr: v.description_fr || null,
    description_ar: v.description_ar || null,
    discount_kind: v.discount_kind,
    discount_value: v.discount_value,
    max_discount_da: v.max_discount_da,
    min_subtotal_da: v.min_subtotal_da,
    starts_at: v.starts_at || null,
    ends_at: v.ends_at || null,
    max_uses: v.max_uses,
    max_uses_per_customer: v.max_uses_per_customer,
    online_only: v.online_only,
    app_only: v.app_only,
    audience: v.audience,
    is_listed: v.is_listed,
    active: v.active,
  };
}

function refresh() {
  revalidatePath("/admin/marketing/codes");
}

export async function createPlatformCode(
  input: CodeInput
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const admin = createAdminClient();
    const { data, error } = await promoTable(admin)
      .insert({ ...toRow(parsed.data), created_by: user?.id ?? null })
      .select("id")
      .single();
    if (error) {
      const msg = error.message.includes("uq_platform_promotions_code")
        ? "Ce code existe déjà."
        : `Échec : ${error.message}`;
      return { error: msg };
    }
    await audit("platform_code_create", data?.id ?? null, parsed.data.code);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[createPlatformCode] failed:", e);
    return { error: "Création impossible pour le moment." };
  }
}

export async function updatePlatformCode(
  id: string,
  input: CodeInput
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const admin = createAdminClient();
    const { error } = await promoTable(admin)
      .update(toRow(parsed.data))
      .eq("id", id);
    if (error) {
      const msg = error.message.includes("uq_platform_promotions_code")
        ? "Ce code existe déjà."
        : `Échec : ${error.message}`;
      return { error: msg };
    }
    await audit("platform_code_update", id, parsed.data.code);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[updatePlatformCode] failed:", e);
    return { error: "Mise à jour impossible." };
  }
}

export async function togglePlatformCode(
  id: string,
  active: boolean
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  try {
    const admin = createAdminClient();
    const { error } = await promoTable(admin).update({ active }).eq("id", id);
    if (error) return { error: `Échec : ${error.message}` };
    await audit(active ? "platform_code_enable" : "platform_code_disable", id);
    refresh();
    return { ok: true };
  } catch {
    return { error: "Action impossible." };
  }
}

export async function deletePlatformCode(
  id: string
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  try {
    const admin = createAdminClient();
    const { error } = await promoTable(admin).delete().eq("id", id);
    if (error) return { error: `Échec : ${error.message}` };
    await audit("platform_code_delete", id);
    refresh();
    return { ok: true };
  } catch {
    return { error: "Suppression impossible." };
  }
}

// ---------------------------------------------------------------------------
// Attribution ciblée : assigner un code à des clients précis (audience targeted).
// ---------------------------------------------------------------------------
export async function grantCodeToCustomers(
  promotionId: string,
  customerIds: string[]
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  if (customerIds.length === 0) return { error: "Aucun client sélectionné." };
  try {
    const admin = createAdminClient();
    const rows = customerIds.map((cid) => ({
      promotion_id: promotionId,
      customer_id: cid,
    }));
    const { error } = await (
      admin.from as unknown as (n: string) => {
        upsert: (
          rows: Record<string, unknown>[],
          opts: { onConflict: string; ignoreDuplicates: boolean }
        ) => Resp;
      }
    )("platform_promotion_grants").upsert(rows, {
      onConflict: "promotion_id,customer_id",
      ignoreDuplicates: true,
    });
    if (error) return { error: `Échec : ${error.message}` };
    await audit(
      "platform_code_grant",
      promotionId,
      `${customerIds.length} client(s)`
    );
    refresh();
    return { ok: true };
  } catch {
    return { error: "Attribution impossible." };
  }
}

// ---------------------------------------------------------------------------
// Bons d'achat (crédit Coligo Pay) — via RPC SECURITY DEFINER (session admin).
// ---------------------------------------------------------------------------
const voucherSchema = z.object({
  amount_da: z.coerce.number().int().positive("Montant invalide."),
  label_fr: z.string().trim().max(80),
  label_ar: z.string().trim().max(80),
  reason: z.enum(["gift", "loyalty", "compensation", "campaign"]),
  /** null = TOUS les clients ; sinon liste d'ids. */
  customer_ids: z.array(z.string().uuid()).nullable(),
});

export type VoucherInput = z.input<typeof voucherSchema>;

export async function issueVoucher(
  input: VoucherInput
): Promise<MarketingActionState & { count?: number }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = voucherSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const v = parsed.data;
  if (v.customer_ids && v.customer_ids.length === 0) {
    return { error: "Aucun client sélectionné." };
  }
  try {
    // Session admin (auth.uid() alimente is_super_admin dans la RPC).
    const supabase = await createClient();
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => PromiseLike<{ data: number | null; error: DbErr }>
    )("admin_grant_voucher", {
      p_customer_ids: v.customer_ids,
      p_amount_da: v.amount_da,
      p_label_fr: v.label_fr || null,
      p_label_ar: v.label_ar || null,
      p_reason: v.reason,
    });
    if (error) return { error: `Échec : ${error.message}` };
    await audit(
      "voucher_issue",
      null,
      `${data ?? 0} bon(s) · ${v.amount_da} DA`
    );
    revalidatePath("/admin/marketing/bons");
    return { ok: true, count: data ?? 0 };
  } catch (e) {
    console.error("[issueVoucher] failed:", e);
    return { error: "Émission impossible pour le moment." };
  }
}

export async function revokeVoucher(
  voucherId: string
): Promise<MarketingActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  try {
    const supabase = await createClient();
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => PromiseLike<{
        data: { ok: boolean; reason: string } | null;
        error: DbErr;
      }>
    )("admin_revoke_voucher", { p_voucher_id: voucherId });
    if (error) return { error: `Échec : ${error.message}` };
    if (!data?.ok) {
      const reason = data?.reason ?? "";
      const msg =
        reason === "already_spent"
          ? "Bon déjà dépensé — révocation impossible."
          : reason === "already_revoked"
            ? "Bon déjà révoqué."
            : "Révocation impossible.";
      return { error: msg };
    }
    await audit("voucher_revoke", voucherId);
    revalidatePath("/admin/marketing/bons");
    return { ok: true };
  } catch {
    return { error: "Révocation impossible." };
  }
}

// ---------------------------------------------------------------------------
// Recherche de clients (ciblage). Par téléphone, nom ou email.
// ---------------------------------------------------------------------------
export type CustomerHit = {
  id: string;
  full_name: string | null;
  phone: string | null;
};

export async function searchCustomers(query: string): Promise<CustomerHit[]> {
  if (!(await adminCan("marketing"))) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .or(`phone.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(15);
  return (data ?? []) as CustomerHit[];
}
