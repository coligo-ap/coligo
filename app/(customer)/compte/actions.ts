"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeContactPhone, DZ_PHONE_ERROR } from "@/lib/dz/phone";

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
  if (full_name.length < 2) {
    return { error: "Entre ton nom et prénom." };
  }
  // Numéro valide OBLIGATOIRE (cas des inscriptions Google sans tel) — mobile
  // algérien par défaut, ou numéro international (E.164).
  const phone = normalizeContactPhone(input.phone);
  if (!phone) {
    return { error: DZ_PHONE_ERROR };
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

  // ANTI-FRAUDE : interdit de basculer vers un email DÉJÀ associé à un autre
  // compte (peu importe la méthode d'inscription : email/mot de passe ou Google).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data: used } = await rpc("email_already_used", { p_email: email });
  if (used === true) {
    return { error: "Cette adresse est déjà associée à un autre compte." };
  }

  // Si l'utilisateur est actuellement bloqué (trop d'essais de code), on ne
  // renvoie pas de nouveau code tant que le délai n'est pas écoulé.
  const admin = createAdminClient();
  const { data: th } = await admin
    .from("email_change_throttle")
    .select("locked_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (th?.locked_until && new Date(th.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil(
      (new Date(th.locked_until).getTime() - Date.now()) / 60000
    );
    return { error: `Trop de tentatives. Réessaie dans ${mins} min.` };
  }

  // NB : fonctionne aussi pour un compte créé via Google — Supabase envoie le
  // code à la NOUVELLE adresse ; l'identité (Google) et le wallet restent liés.
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
  const token = (input.token ?? "").replace(/\D/g, "");
  if (!EMAIL_RE.test(email)) return { error: "Adresse email invalide." };
  // Code Supabase à 6 chiffres (config projet alignée à 6).
  if (token.length < 6) return { error: "Entre le code à 6 chiffres reçu." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // ANTI-BRUTEFORCE : 3 essais ratés → blocage 10 min, puis 20 min (escalade).
  const admin = createAdminClient();
  const { data: th } = await admin
    .from("email_change_throttle")
    .select("fails, lock_level, locked_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (th?.locked_until && new Date(th.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil(
      (new Date(th.locked_until).getTime() - Date.now()) / 60000
    );
    return { error: `Trop de tentatives. Réessaie dans ${mins} min.` };
  }

  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email_change",
  });
  if (error) {
    const fails = (th?.fails ?? 0) + 1;
    if (fails >= 3) {
      const lock_level = (th?.lock_level ?? 0) + 1;
      const minutes = lock_level <= 1 ? 10 : 20;
      await admin.from("email_change_throttle").upsert({
        user_id: user.id,
        fails: 0,
        lock_level,
        locked_until: new Date(Date.now() + minutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      return {
        error: `Code incorrect. Trop de tentatives : réessaie dans ${minutes} min.`,
      };
    }
    await admin.from("email_change_throttle").upsert({
      user_id: user.id,
      fails,
      updated_at: new Date().toISOString(),
    });
    return { error: `Code invalide. ${3 - fails} essai(s) restant(s).` };
  }

  // Succès → on efface le compteur de tentatives.
  await admin.from("email_change_throttle").delete().eq("user_id", user.id);

  // Synchronise customers.email avec la nouvelle adresse auth.
  await supabase.from("customers").update({ email }).eq("user_id", user.id);

  // L'identité (user_id/customers.id) est inchangée → wallet et historique
  // intacts. On journalise le changement d'email pour l'audit.
  await logSecurityEvent(supabase, "email_changed");

  revalidatePath("/compte");
  return { success: "Adresse email mise à jour." };
}

// =============================================================================
// SUPPRESSION DE COMPTE CLIENT — exigence Google Play (et bonne pratique RGPD)
// =============================================================================
// Le user auth ne peut PAS être physiquement supprimé : customers.user_id est
// en ON DELETE CASCADE, et la ligne customers entraînerait en cascade les
// REGISTRES FINANCIERS (customer_wallet_entries, coligo_pay_payments, rides…)
// dont dépendent la comptabilité plateforme et integrity_violations(). La
// suppression est donc une ANONYMISATION COMPLÈTE (aucune donnée personnelle
// résiduelle) + NEUTRALISATION du compte auth (email brouillé, mot de passe
// aléatoire, bannissement) — les écritures comptables, elles, sont conservées
// (rétention légitime, sans identité rattachée).

export type DeleteAccountState = { error?: string; done?: boolean };

/** Statuts de course Drive considérés « en vol » (index uniq_active_ride). */
const ACTIVE_RIDE_STATUSES = [
  "searching",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
] as const;

export async function deleteMyCustomerAccount(): Promise<DeleteAccountState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { error: "Profil client introuvable." };

  // Compte hybride (espace pro rattaché au même login) : la fermeture passe
  // par le support — on ne détruit pas un commerce/livreur depuis /compte.
  const [{ data: merchant }, { data: driver }, { data: chauffeur }] =
    await Promise.all([
      admin.from("merchants").select("id").eq("user_id", user.id).maybeSingle(),
      admin.from("drivers").select("id").eq("user_id", user.id).maybeSingle(),
      admin
        .from("chauffeurs")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
  if (merchant || driver || chauffeur) {
    return {
      error:
        "Ce compte est aussi un compte professionnel (commerce, livreur ou chauffeur). Contacte le support pour le fermer.",
    };
  }

  // GARDE : rien d'« en vol ». Une commande/course active implique de l'argent
  // ou une logistique en cours — terminer (ou annuler) avant de supprimer.
  const { count: activeOrders } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer.id)
    .not("status", "in", "(completed,cancelled)");
  if ((activeOrders ?? 0) > 0) {
    return {
      error:
        "Tu as une commande en cours. Attends qu'elle soit terminée (ou annule-la) avant de supprimer ton compte.",
    };
  }
  const { count: activeRides } = await admin
    .from("rides")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer.id)
    .in("status", ACTIVE_RIDE_STATUSES);
  if ((activeRides ?? 0) > 0) {
    return {
      error:
        "Tu as une course en cours. Attends qu'elle soit terminée avant de supprimer ton compte.",
    };
  }

  try {
    // 1-3) Anonymisation ATOMIQUE côté SQL (mig 0375) : profil scrubé (la
    //    ligne customers RESTE — pivot des commandes/courses/wallets/ledgers,
    //    zéro impact comptable ni commerçant), snapshots PII des commandes
    //    effacés (coordonnées arrondies ~1 km : la contrainte géo et les
    //    stats de zone restent satisfaites), adresses textuelles des courses
    //    effacées, adresses/favoris/tokens supprimés. Tout-ou-rien : plus
    //    jamais de compte à moitié anonymisé si une contrainte évolue.
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data: anonRes, error: anonErr } = await rpc(
      "customer_anonymize_data",
      { p_customer: customer.id }
    );
    if (anonErr) throw anonErr;
    const anon = (anonRes ?? {}) as { ok?: boolean; error?: string };
    if (!anon.ok) {
      if (anon.error === "active_order") {
        return {
          error:
            "Tu as une commande en cours. Attends qu'elle soit terminée (ou annule-la) avant de supprimer ton compte.",
        };
      }
      if (anon.error === "active_ride") {
        return {
          error:
            "Tu as une course en cours. Attends qu'elle soit terminée avant de supprimer ton compte.",
        };
      }
      throw new Error(anon.error ?? "anonymize_failed");
    }

    // 4) Neutralisation auth : email brouillé (l'ancien redevient réutilisable
    //    pour un nouveau compte), mot de passe aléatoire, métadonnées vidées
    //    (nom/avatar OAuth), bannissement long → plus aucun refresh possible.
    const anonEmail = `supprime.${customer.id.slice(0, 8)}.${Date.now().toString(36)}@deleted.coligo.app`;
    const randomPassword =
      globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Date.now()}`;
    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      email: anonEmail,
      email_confirm: true,
      password: randomPassword,
      user_metadata: { deleted: true },
      ban_duration: "876000h", // ~100 ans
    });
    if (authErr) throw authErr;

    // 4bis) DÉTACHE les identités OAuth (Google…) du compte banni : sans ça,
    // le compte Google resterait « lié » à un utilisateur banni pour toujours
    // → « user is banned » à toute re-connexion, même pour créer un NOUVEAU
    // compte (bug vécu iOS). Identités supprimées ⇒ une future connexion
    // Google crée un utilisateur TOUT NEUF (l'anti-abus des avantages de
    // bienvenue est géré par la mémoire d'appareil des promos, pas par un
    // blocage définitif du compte Google). API admin GoTrue (pas encore
    // couverte par supabase-js) → REST direct, best-effort tracé.
    try {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
      const srk = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const headers = { apikey: srk, Authorization: `Bearer ${srk}` };
      const ures = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
        headers,
        cache: "no-store",
      });
      const ujson = (await ures.json()) as {
        identities?: { identity_id?: string; id?: string; provider: string }[];
      };
      for (const ident of ujson.identities ?? []) {
        if (ident.provider === "email") continue;
        const iid = ident.identity_id ?? ident.id;
        if (!iid) continue;
        await fetch(
          `${base}/auth/v1/admin/users/${user.id}/identities/${iid}`,
          { method: "DELETE", headers }
        );
      }
    } catch (identErr) {
      // Non bloquant : le ban protège déjà — mais on trace pour réconcilier.
      console.error("[compte] détachement identités OAuth :", identErr);
    }
  } catch (err) {
    console.error("[compte] deleteMyCustomerAccount failed:", err);
    return {
      error:
        "La suppression a échoué. Réessaie, ou contacte le support si le problème persiste.",
    };
  }

  // 5) Fin de session locale (cookies) — le ban couvre les autres appareils.
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  return { done: true };
}
