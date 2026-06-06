"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string; success?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Journalise une action sensible (best-effort, jamais bloquant). La fonction SQL
 * résout le client via auth.uid() et n'enregistre que pour un vrai client.
 */
async function logSecurityEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  event: "email_changed" | "phone_changed"
): Promise<void> {
  try {
    await supabase.rpc(
      "coligo_log_security_event" as never,
      {
        p_event: event,
        p_detail: null,
      } as never
    );
  } catch {
    /* journal best-effort : un échec ne casse jamais l'action */
  }
}

/** Met à jour le nom + le téléphone du client (aucune confirmation requise). */
export async function updateProfile(input: {
  full_name: string;
  phone: string;
}): Promise<ProfileState> {
  const full_name = (input.full_name ?? "").trim();
  const phone = (input.phone ?? "").trim();
  if (full_name.length < 2) {
    return { error: "Entre ton nom et prénom." };
  }
  if (phone.replace(/\D/g, "").length < 8) {
    return { error: "Numéro de téléphone invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // Téléphone actuel (pour ne journaliser QUE s'il change réellement).
  const { data: existing } = await supabase
    .from("customers")
    .select("phone")
    .eq("user_id", user.id)
    .maybeSingle();
  const phoneChanged = (existing?.phone ?? "").trim() !== phone;

  const { error } = await supabase
    .from("customers")
    .update({ full_name, phone })
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  // Garde le nom aussi dans les métadonnées auth (cohérence).
  await supabase.auth.updateUser({ data: { full_name } });

  // NB : le wallet (solde, PIN, pay_handle, paiements, transferts) est indexé
  // par customers.id — modifier le téléphone ne fait RIEN perdre. On journalise
  // juste l'action pour la traçabilité.
  if (phoneChanged) await logSecurityEvent(supabase, "phone_changed");

  revalidatePath("/compte");
  return { success: "Profil mis à jour." };
}

/**
 * Demande un changement d'email : Supabase envoie un CODE à la nouvelle
 * adresse (template « Change Email Address » avec {{ .Token }}). Le client
 * valide ensuite via confirmEmailChange.
 */
export async function requestEmailChange(input: {
  email: string;
}): Promise<ProfileState> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Adresse email invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };
  if (email === (user.email ?? "").toLowerCase()) {
    return { error: "C'est déjà ton adresse actuelle." };
  }

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: `Erreur : ${error.message}` };

  return { success: "Code envoyé à ta nouvelle adresse." };
}

/** Confirme le changement d'email avec le code reçu (OTP type email_change). */
export async function confirmEmailChange(input: {
  email: string;
  token: string;
}): Promise<ProfileState> {
  const email = (input.email ?? "").trim().toLowerCase();
  const token = (input.token ?? "").replace(/\s/g, "");
  if (!EMAIL_RE.test(email)) return { error: "Adresse email invalide." };
  if (token.length < 6) return { error: "Entre le code à 6 chiffres reçu." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email_change",
  });
  if (error) return { error: `Code invalide ou expiré (${error.message}).` };

  // Synchronise customers.email avec la nouvelle adresse auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("customers").update({ email }).eq("user_id", user.id);
  }

  // L'identité (user_id/customers.id) est inchangée → wallet et historique
  // intacts. On journalise le changement d'email pour l'audit.
  await logSecurityEvent(supabase, "email_changed");

  revalidatePath("/compte");
  return { success: "Adresse email mise à jour." };
}
