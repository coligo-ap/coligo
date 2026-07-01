"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner, getAdminContext, ADMIN_SCOPES } from "@/lib/auth/admin";

// =============================================================================
// Gestion des super-admins (OWNER-ONLY) — création de sous-admins « staff » et
// attribution de DOMAINES. Toutes les écritures passent par le service-role
// (createAdminClient, bypass RLS) MAIS restent gardées par `requireOwner()` :
// un staff ne peut jamais atteindre ces actions (fail-closed serveur), et la
// RLS `platform_admins_write_owner` (mig 0301) verrouille aussi la table.
//
// Garde-fous base (mig 0301, trigger assert_last_owner_kept) : impossible de
// supprimer / rétrograder / désactiver le DERNIER owner actif. On re-vérifie
// aussi ici pour renvoyer un message clair avant de toucher la base.
// =============================================================================

export type AdminActionState = { error?: string; ok?: boolean };

const DENIED: AdminActionState = { error: "Accès refusé." };

/** Accès non typé à platform_admins (colonnes RBAC hors database.types). */
type LooseAdmin = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert: (v: Record<string, unknown>) => Promise<{
      error: { message: string } | null;
    }>;
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        v: string
      ) => Promise<{ error: { message: string } | null }>;
    };
    delete: () => {
      eq: (
        c: string,
        v: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(
    input
      .map((d) => String(d).trim())
      .filter((d) => (ADMIN_SCOPES as string[]).includes(d))
  );
  return [...set];
}

/** Email de l'owner courant (pour interdire l'édition de son propre compte). */
async function currentEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email?.toLowerCase() ?? null;
}

async function logAdmin(action: string, targetEmail: string, note?: string) {
  try {
    const me = await currentEmail();
    await createAdminClient()
      .from("admin_audit_log")
      .insert({
        admin_email: me,
        action,
        target_kind: "admin",
        target_id: null,
        note: note ? `${targetEmail} — ${note}` : targetEmail,
      });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action */
  }
}

/**
 * Crée un sous-admin STAFF : compte auth (email réel + mot de passe temporaire)
 * puis ligne platform_admins scopée aux domaines choisis. Si l'email existe déjà
 * en auth, on PROMEUT le compte existant (sans changer son mot de passe).
 */
export async function createStaffAdmin(input: {
  email: string;
  label?: string;
  password: string;
  domains: string[];
}): Promise<AdminActionState> {
  await requireOwner();

  const email = String(input.email ?? "")
    .trim()
    .toLowerCase();
  const label = String(input.label ?? "").trim() || null;
  const password = String(input.password ?? "");
  const domains = cleanDomains(input.domains);

  if (!EMAIL_RE.test(email)) return { error: "Email invalide." };
  if (password.length < 8) {
    return { error: "Le mot de passe doit faire au moins 8 caractères." };
  }
  if (domains.length === 0) {
    return { error: "Choisis au moins un domaine." };
  }

  const admin = createAdminClient();
  const loose = admin as unknown as LooseAdmin;

  // Déjà admin ?
  const { data: existing } = await loose
    .from("platform_admins")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (existing) return { error: "Cet email est déjà administrateur." };

  // Compte auth : créer, ou récupérer l'id s'il existe déjà.
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    const alreadyExists = msg.includes("already") || msg.includes("registered");
    if (!alreadyExists) {
      return {
        error: `Création du compte impossible : ${created.error.message}`,
      };
    }
    // Compte déjà existant → on le promeut (id retrouvé par listing paginé).
    userId = await findAuthUserIdByEmail(admin, email);
  } else {
    userId = created.data.user?.id ?? null;
  }

  const me = await currentEmail();
  const { error: insErr } = await loose.from("platform_admins").insert({
    email,
    role: "staff",
    domains,
    is_active: true,
    label,
    created_by: me,
    user_id: userId,
  });
  if (insErr) {
    return { error: `Échec de l'enregistrement : ${insErr.message}` };
  }

  await logAdmin("create_admin", email, `staff · ${domains.join(", ")}`);
  revalidatePath("/admin/admins");
  return { ok: true };
}

/** Retrouve l'id auth d'un email (listing paginé — usage rare, owner-only). */
async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Met à jour les domaines d'un staff (owner = toujours tous, non éditable). */
export async function updateAdminDomains(
  email: string,
  domains: string[]
): Promise<AdminActionState> {
  await requireOwner();
  const target = String(email ?? "")
    .trim()
    .toLowerCase();
  const me = await currentEmail();
  if (target === me) return { error: "Édite ton propre compte ailleurs." };

  const clean = cleanDomains(domains);
  if (clean.length === 0) return { error: "Choisis au moins un domaine." };

  const loose = createAdminClient() as unknown as LooseAdmin;
  const { data: row } = await loose
    .from("platform_admins")
    .select("role")
    .eq("email", target)
    .maybeSingle();
  if (!row) return { error: "Administrateur introuvable." };
  if (row.role === "owner") {
    return { error: "Un owner a déjà accès à tous les domaines." };
  }

  const { error } = await loose
    .from("platform_admins")
    .update({ domains: clean })
    .eq("email", target);
  if (error) return { error: error.message };

  await logAdmin("update_admin_domains", target, clean.join(", "));
  revalidatePath("/admin/admins");
  return { ok: true };
}

/** Bascule owner ↔ staff. Le trigger DB protège le dernier owner. */
export async function setAdminRole(
  email: string,
  role: "owner" | "staff"
): Promise<AdminActionState> {
  await requireOwner();
  if (role !== "owner" && role !== "staff") return { error: "Rôle invalide." };
  const target = String(email ?? "")
    .trim()
    .toLowerCase();
  const me = await currentEmail();
  if (target === me)
    return { error: "Tu ne peux pas changer ton propre rôle." };

  const loose = createAdminClient() as unknown as LooseAdmin;
  // Promotion owner → domaines vidés (owner = tous). Rétrogradation → domaines
  // vides par défaut (l'owner devra ré-attribuer explicitement).
  const { error } = await loose
    .from("platform_admins")
    .update({ role, domains: [] })
    .eq("email", target);
  if (error) {
    // Message clair pour le garde « dernier owner » (trigger).
    if (error.message.includes("owner")) {
      return { error: "Impossible : c'est le dernier owner actif." };
    }
    return { error: error.message };
  }

  await logAdmin("set_admin_role", target, role);
  revalidatePath("/admin/admins");
  return { ok: true };
}

/** Suspend / réactive un admin (perte de tout accès sans suppression). */
export async function toggleAdminActive(
  email: string,
  active: boolean
): Promise<AdminActionState> {
  await requireOwner();
  const target = String(email ?? "")
    .trim()
    .toLowerCase();
  const me = await currentEmail();
  if (target === me) {
    return { error: "Tu ne peux pas te désactiver toi-même." };
  }

  const loose = createAdminClient() as unknown as LooseAdmin;
  const { error } = await loose
    .from("platform_admins")
    .update({ is_active: active })
    .eq("email", target);
  if (error) {
    if (error.message.includes("owner")) {
      return { error: "Impossible : c'est le dernier owner actif." };
    }
    return { error: error.message };
  }

  await logAdmin(active ? "activate_admin" : "suspend_admin", target);
  revalidatePath("/admin/admins");
  return { ok: true };
}

/** Réinitialise le mot de passe d'un admin (via son compte auth). */
export async function resetAdminPassword(
  email: string,
  newPassword: string
): Promise<AdminActionState> {
  await requireOwner();
  const target = String(email ?? "")
    .trim()
    .toLowerCase();
  const pwd = String(newPassword ?? "");
  if (pwd.length < 8) {
    return { error: "Le mot de passe doit faire au moins 8 caractères." };
  }

  const admin = createAdminClient();
  const loose = admin as unknown as LooseAdmin;
  const { data: row } = await loose
    .from("platform_admins")
    .select("user_id")
    .eq("email", target)
    .maybeSingle();
  const userId =
    (row?.user_id as string | null) ??
    (await findAuthUserIdByEmail(admin, target));
  if (!userId) return { error: "Compte auth introuvable pour cet admin." };

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: pwd,
  });
  if (error) return { error: error.message };

  await logAdmin("reset_admin_password", target);
  return { ok: true };
}

/**
 * Révoque les droits admin (supprime la ligne platform_admins). Le compte auth
 * n'est PAS supprimé (peut correspondre à une personne réelle) — il perd juste
 * l'accès /admin. Le trigger DB empêche de retirer le dernier owner.
 */
export async function deleteAdmin(email: string): Promise<AdminActionState> {
  await requireOwner();
  const target = String(email ?? "")
    .trim()
    .toLowerCase();
  const me = await currentEmail();
  if (target === me) return { error: "Tu ne peux pas te retirer toi-même." };

  const loose = createAdminClient() as unknown as LooseAdmin;
  const { error } = await loose
    .from("platform_admins")
    .delete()
    .eq("email", target);
  if (error) {
    if (error.message.includes("owner")) {
      return { error: "Impossible : c'est le dernier owner actif." };
    }
    return { error: error.message };
  }

  await logAdmin("delete_admin", target);
  revalidatePath("/admin/admins");
  return { ok: true };
}

/** Garde d'appel : expose le contexte (utile aux composants). */
export async function assertOwner(): Promise<AdminActionState> {
  const ctx = await getAdminContext();
  return ctx.isOwner ? { ok: true } : DENIED;
}
