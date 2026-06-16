"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { phoneToPartnerEmail } from "@/lib/auth/partner";

export type PartnerAuthState = { error?: string };

const loginSchema = z.object({
  phone: z.string().min(6, "Téléphone requis."),
  password: z.string().min(1, "Mot de passe requis."),
});

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
