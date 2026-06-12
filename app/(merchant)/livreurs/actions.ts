"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateReferralCode,
  hashReferralCode,
} from "@/lib/drivers/referral-code";

export type DriverActionResult = {
  error?: string;
  success?: string;
  /** Renvoyé UNIQUEMENT après une (re)génération — à montrer 1 fois au commerçant. */
  newCode?: string;
};

/** Récupère le merchant du user courant ou renvoie une erreur. */
async function requireOwnedMerchant(): Promise<
  { id: string; slug: string; ownerEmail: string | null } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };
  const { data: m } = await supabase
    .from("merchants")
    .select("id, slug")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!m) return { error: "Boutique introuvable." };
  return { id: m.id, slug: m.slug, ownerEmail: user.email ?? null };
}

async function logEvent(
  merchantId: string,
  actorEmail: string | null,
  driverId: string | null,
  action: string,
  note?: string
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("merchant_driver_events").insert({
    merchant_id: merchantId,
    driver_id: driverId,
    actor_email: actorEmail,
    action,
    note: note ?? null,
  });
}

// ---------------------------------------------------------------------------
// Génération / régénération du code
// ---------------------------------------------------------------------------

/**
 * (Re)génère le code de référence du commerçant :
 *  - Désactive l'éventuel code actif courant.
 *  - Insère un nouveau code (en clair retourné UNE fois).
 *
 * IMPORTANT : régénérer le code n'affecte PLUS les livreurs déjà rattachés —
 * ils conservent leur accès. Seul l'ancien code cesse de fonctionner pour les
 * NOUVELLES demandes. Pour couper l'accès de tout le monde et forcer une
 * re-validation (cas « le code a fuité »), utiliser `resetAllDriverAccess`,
 * qui est désormais une action SÉPARÉE et explicite.
 *
 * Le code en clair n'est JAMAIS écrit en log, ni en colonne, ni renvoyé
 * autrement que dans ce seul retour de Server Action.
 */
const regenerateInput = z.object({
  expiresAt: z
    .string()
    .nullable()
    .optional()
    .transform((v) =>
      v == null || v === "" ? null : new Date(v).toISOString()
    ),
});

export async function regenerateReferralCode(
  input: { expiresAt?: string | null } = {}
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const parsed = regenerateInput.safeParse(input);
  if (!parsed.success) return { error: "Date d'expiration invalide." };

  const code = generateReferralCode(ctx.slug);
  const codeHash = hashReferralCode(code);

  // Admin pour mises à jour multi-tables (et toucher merchant_drivers d'autres
  // users sans souci RLS — par sécurité, plus simple en service_role).
  const admin = createAdminClient();

  // 1) Désactive l'ancien code actif.
  await admin
    .from("merchant_referral_codes")
    .update({ is_active: false })
    .eq("merchant_id", ctx.id)
    .eq("is_active", true);

  // 2) Insère le nouveau.
  const { error: insertErr } = await admin
    .from("merchant_referral_codes")
    .insert({
      merchant_id: ctx.id,
      code_hash: codeHash,
      is_active: true,
      expires_at: parsed.data.expiresAt,
    });
  if (insertErr) return { error: `Échec : ${insertErr.message}` };

  await logEvent(ctx.id, ctx.ownerEmail, null, "code_regenerated");

  revalidatePath("/livreurs");
  return {
    newCode: code,
    success: "Nouveau code généré. Tes livreurs actuels gardent leur accès.",
  };
}

// ---------------------------------------------------------------------------
// Réinitialiser les accès de TOUS les livreurs (action séparée, sensible)
// ---------------------------------------------------------------------------
/**
 * Repasse tous les livreurs ACTIFS du commerçant en `pending` et révoque leurs
 * sessions (`sessions_revoked_at`). À utiliser quand on veut re-valider tout le
 * monde (départ massif, code soupçonné fuité…). N'altère PAS le code de
 * référence — c'est volontairement découplé de `regenerateReferralCode`.
 */
export async function resetAllDriverAccess(): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("merchant_drivers")
    .update(
      {
        status: "pending",
        sessions_revoked_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("merchant_id", ctx.id)
    .eq("status", "active");
  if (error) return { error: `Échec : ${error.message}` };

  await logEvent(
    ctx.id,
    ctx.ownerEmail,
    null,
    "all_access_reset",
    `${count ?? 0} livreur(s) remis en attente`
  );

  revalidatePath("/livreurs");
  return {
    success:
      (count ?? 0) > 0
        ? `${count} livreur(s) remis en attente. Ils devront re-soumettre le code.`
        : "Aucun livreur actif à réinitialiser.",
  };
}

// ---------------------------------------------------------------------------
// Expiration du code (uniquement modifier la date sans régénérer)
// ---------------------------------------------------------------------------
export async function setReferralCodeExpiration(
  expiresAt: string | null
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const iso =
    expiresAt && expiresAt !== "" ? new Date(expiresAt).toISOString() : null;

  const { error } = await supabase
    .from("merchant_referral_codes")
    .update({ expires_at: iso })
    .eq("merchant_id", ctx.id)
    .eq("is_active", true);

  if (error) return { error: `Échec : ${error.message}` };

  await logEvent(
    ctx.id,
    ctx.ownerEmail,
    null,
    "code_expiration_set",
    iso ?? "no_expiration"
  );

  revalidatePath("/livreurs");
  return { success: "Expiration mise à jour." };
}

// ---------------------------------------------------------------------------
// Accepter / refuser une demande (status: pending → active / supprimé)
// ---------------------------------------------------------------------------
export async function acceptDriverRequest(
  driverId: string
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_drivers")
    .update({ status: "active" })
    .eq("merchant_id", ctx.id)
    .eq("driver_id", driverId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  await logEvent(ctx.id, ctx.ownerEmail, driverId, "request_accepted");
  revalidatePath("/livreurs");
  return { success: "Livreur accepté." };
}

export async function refuseDriverRequest(
  driverId: string
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_drivers")
    .delete()
    .eq("merchant_id", ctx.id)
    .eq("driver_id", driverId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  await logEvent(ctx.id, ctx.ownerEmail, driverId, "request_refused");
  revalidatePath("/livreurs");
  return { success: "Demande refusée." };
}

// ---------------------------------------------------------------------------
// Bloquer / débloquer / supprimer un livreur actif
// ---------------------------------------------------------------------------
export async function blockDriver(
  driverId: string
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  // Le trigger merchant_drivers_status_change touche sessions_revoked_at
  // automatiquement quand status passe à 'blocked' → accès révoqué immédiat.
  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_drivers")
    .update({ status: "blocked" })
    .eq("merchant_id", ctx.id)
    .eq("driver_id", driverId);
  if (error) return { error: error.message };

  await logEvent(ctx.id, ctx.ownerEmail, driverId, "driver_blocked");
  revalidatePath("/livreurs");
  return { success: "Livreur bloqué." };
}

export async function unblockDriver(
  driverId: string
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_drivers")
    .update({ status: "pending" })
    .eq("merchant_id", ctx.id)
    .eq("driver_id", driverId)
    .eq("status", "blocked");
  if (error) return { error: error.message };

  await logEvent(ctx.id, ctx.ownerEmail, driverId, "driver_unblocked");
  revalidatePath("/livreurs");
  return { success: "Statut remis à `en attente`." };
}

export async function removeDriver(
  driverId: string
): Promise<DriverActionResult> {
  const ctx = await requireOwnedMerchant();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_drivers")
    .delete()
    .eq("merchant_id", ctx.id)
    .eq("driver_id", driverId);
  if (error) return { error: error.message };

  await logEvent(ctx.id, ctx.ownerEmail, driverId, "driver_removed");
  revalidatePath("/livreurs");
  return { success: "Livreur retiré." };
}
