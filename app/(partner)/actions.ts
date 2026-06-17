"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PARTNER_DOMAIN,
  normalizePhone,
  phoneToPartnerEmail,
} from "@/lib/auth/partner";

export type PartnerAuthState = { error?: string };

const loginSchema = z.object({
  phone: z.string().min(6, "Téléphone requis."),
  password: z.string().min(1, "Mot de passe requis."),
});

const signupSchema = z.object({
  displayName: z.string().trim().min(2, "Nom du point de recharge requis."),
  ownerName: z.string().trim().min(2, "Nom du gérant requis."),
  phone: z.string().trim().min(6, "Téléphone requis."),
  password: z.string().min(6, "Mot de passe : 6 caractères minimum."),
  registreCommerce: z
    .string()
    .trim()
    .min(2, "N° de registre de commerce requis."),
  wilaya: z.string().trim().optional(),
  commune: z.string().trim().optional(),
  address: z.string().trim().optional(),
  lat: z.coerce.number().finite({ message: "Position sur la carte requise." }),
  lng: z.coerce.number().finite({ message: "Position sur la carte requise." }),
  hours: z.string().trim().optional(),
});

/**
 * AUTO-INSCRIPTION Agent Coligo Pay. Crée le compte de connexion (email
 * synthétique <tel>@partners.coligo.local) + le portefeuille partenaire en
 * statut `pending` (INERTE : pas de revente, invisible au public) — le
 * super-admin examine ensuite le dossier. Anti-doublon : l'email étant déduit
 * du téléphone, un même numéro ne peut pas créer deux comptes.
 */
export async function partnerSignup(
  _prev: PartnerAuthState,
  formData: FormData
): Promise<PartnerAuthState> {
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    ownerName: formData.get("ownerName"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    registreCommerce: formData.get("registreCommerce"),
    wilaya: formData.get("wilaya"),
    commune: formData.get("commune"),
    address: formData.get("address"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    hours: formData.get("hours"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Formulaire incomplet.",
    };
  }
  const v = parsed.data;
  // Une position non confirmée arrive en chaîne vide → coercée en 0. La latitude
  // ne peut pas être nulle en Algérie (≈ 19–37°) → on exige une vraie position.
  if (!v.lat || !v.lng) {
    return { error: "Confirmez la position de votre point sur la carte." };
  }

  let email: string;
  try {
    email = `${normalizePhone(v.phone)}@${PARTNER_DOMAIN}`;
  } catch {
    return { error: "Téléphone invalide." };
  }

  const admin = createAdminClient();

  // 1. Compte de connexion — createUser ÉCHOUE si l'email (donc le téléphone)
  //    existe déjà → anti-doublon natif.
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: v.password,
    email_confirm: true,
  });
  if (authErr || !created?.user) {
    return {
      error: /registered|exists|duplicate/i.test(authErr?.message ?? "")
        ? "Ce téléphone a déjà un compte Agent Coligo Pay — connectez-vous."
        : "Création du compte échouée. Réessayez.",
    };
  }
  const ownerId = created.user.id;

  // 2. Portefeuille partenaire en attente de validation.
  const insert = (
    admin.from as unknown as (t: string) => {
      insert: (
        v: Record<string, unknown>
      ) => Promise<{ error: { message: string } | null }>;
    }
  )("operator_wallets").insert({
    owner_type: "partner",
    owner_id: ownerId,
    is_partner: true,
    status: "pending",
    is_verified: false,
    display_name: v.displayName,
    owner_name: v.ownerName,
    registre_commerce: v.registreCommerce,
    phone: v.phone,
    hours: v.hours || null,
    wilaya: v.wilaya || null,
    commune: v.commune || null,
    address: v.address || null,
    lat: v.lat,
    lng: v.lng,
    submitted_at: new Date().toISOString(),
  });
  const { error: wErr } = await insert;
  if (wErr) {
    // Rollback du compte auth pour ne pas laisser d'orphelin.
    await admin.auth.admin.deleteUser(ownerId);
    return { error: "Échec de l'enregistrement du dossier. Réessayez." };
  }

  // 3. Ouvre la session → l'agent arrive sur son espace (étape « documents »).
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password: v.password });
  redirect("/partenaire");
}

export type PartnerDoc = {
  id: string;
  kind: "registre_commerce" | "piece_identite" | "autre";
  label: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
};

/** Pièces du dossier de l'agent connecté (avec leur statut de validation). */
export async function getMyPartnerDocuments(): Promise<PartnerDoc[]> {
  const supabase = await createClient();
  const { data } = await (
    supabase.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => Promise<{
          data:
            | {
                id: string;
                kind: string;
                label: string | null;
                status: string;
                review_note: string | null;
                created_at: string;
              }[]
            | null;
        }>;
      };
    }
  )("partner_documents")
    .select("id, kind, label, status, review_note, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []).map((d) => ({
    id: d.id,
    kind: d.kind as PartnerDoc["kind"],
    label: d.label,
    status: d.status as PartnerDoc["status"],
    reviewNote: d.review_note,
    createdAt: d.created_at,
  }));
}

/** Enregistre une pièce déjà téléversée (dossier wallet_id) dans le dossier. */
export async function submitPartnerDocument(input: {
  kind: "registre_commerce" | "piece_identite" | "autre";
  path: string;
  label?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("partner_add_document", {
    p_kind: input.kind,
    p_url: input.path,
    p_label: input.label ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/partenaire");
  return { ok: true };
}

/** Connexion partenaire (téléphone + mot de passe). */
export async function partnerLogin(
  _prev: PartnerAuthState,
  formData: FormData
): Promise<PartnerAuthState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Téléphone et mot de passe requis." };

  const supabase = await createClient();
  let email: string;
  try {
    email = phoneToPartnerEmail(parsed.data.phone);
  } catch {
    return { error: "Téléphone invalide." };
  }
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error) return { error: "Téléphone ou mot de passe incorrect." };
  redirect("/partenaire");
}

export async function partnerLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/partenaire/login");
}

export type PartnerStats = {
  balanceDa: number;
  totalTopupDa: number;
  totalSoldDa: number;
  totalBonusDa: number;
  salesCount: number;
};

export async function getPartnerStats(): Promise<PartnerStats | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_partner_stats");
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    balanceDa: r.balance_da,
    totalTopupDa: r.total_topup_da,
    totalSoldDa: r.total_sold_da,
    totalBonusDa: r.total_bonus_da,
    salesCount: r.sales_count,
  };
}

/** Recherche d'un acheteur (livreur/chauffeur) par téléphone. */
export async function findBuyer(phone: string): Promise<{
  walletId: string;
  ownerType: string;
  name: string | null;
  status: string;
} | null> {
  if (!phone.trim()) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_operator_wallet_by_phone", {
    p_phone: phone.trim(),
  });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    walletId: r.wallet_id,
    ownerType: r.owner_type,
    name: r.name,
    status: r.status,
  };
}

/** Revente de crédit (partenaire → acheteur), protégée par PIN. */
export async function sellCredit(input: {
  targetWalletId: string;
  amountDa: number;
  pin: string;
  opId: string;
}): Promise<{ ok: boolean; error?: string; sellerBalance?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("coligo_recharge_sell", {
    p_target_wallet_id: input.targetWalletId,
    p_amount_da: Math.round(input.amountDa),
    p_pin: input.pin,
    p_op_id: input.opId,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    seller_balance?: number;
  };
  if (!r.ok) return { ok: false, error: mapSellError(r.error) };
  return { ok: true, sellerBalance: r.seller_balance };
}

function mapSellError(code?: string): string {
  switch (code) {
    case "insufficient":
      return "Solde insuffisant pour cette vente.";
    case "pin_wrong":
      return "Code PIN incorrect.";
    case "pin_locked":
      return "PIN bloqué (trop d'essais) — réessayez dans 15 min.";
    case "pin_not_set":
      return "Définissez d'abord votre code PIN.";
    case "target_unavailable":
      return "Bénéficiaire indisponible.";
    case "not_active_partner":
      return "Votre compte n'est pas actif.";
    case "bad_amount":
      return "Montant invalide.";
    case "self_target":
      return "Bénéficiaire invalide.";
    default:
      return code ?? "Échec de la vente.";
  }
}

export async function getPinStatus(): Promise<{
  hasPin: boolean;
  locked: boolean;
}> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("operator_pin_status");
  const r = (data ?? {}) as { has_pin?: boolean; locked?: boolean };
  return { hasPin: !!r.has_pin, locked: !!r.locked };
}

export async function setPin(
  pin: string
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9]{4}$/.test(pin))
    return { ok: false, error: "Le PIN doit faire 4 chiffres." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("operator_set_pin", {
    p_pin: pin,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Échec." };
}
