"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";

// =============================================================================
// Gestion des chauffeurs VTC (super-admin).
// Population SÉPARÉE des livreurs (table `chauffeurs`, mig 0131). Un chauffeur
// est créé avec is_verified=false et NE PEUT PAS rouler tant que l'admin ne l'a
// pas vérifié (chauffeurs_present_near exige is_verified + !frozen + !blocked).
// Écritures via service-role (bypass RLS), gardées par isSuperAdmin() + audit.
// =============================================================================

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(action: string, chauffeurId: string) {
  try {
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "chauffeur",
      target_id: chauffeurId,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

type ChauffeurFlags = {
  is_verified?: boolean;
  is_frozen?: boolean;
  is_blocked?: boolean;
};

async function setFlag(
  chauffeurId: string,
  patch: ChauffeurFlags,
  action: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  if (!chauffeurId) return { error: "Chauffeur manquant." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update(patch)
    .eq("id", chauffeurId);
  if (error) return { error: error.message };
  await audit(action, chauffeurId);
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Vérifie (ou retire la vérif) — autorise/interdit le chauffeur à rouler. */
export async function setChauffeurVerified(
  chauffeurId: string,
  verified: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_verified: verified },
    verified ? "verify_chauffeur" : "unverify_chauffeur"
  );
}

/** Gel souple (le chauffeur ne reçoit plus de courses, mais reste vérifié). */
export async function setChauffeurFrozen(
  chauffeurId: string,
  frozen: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_frozen: frozen },
    frozen ? "freeze_chauffeur" : "unfreeze_chauffeur"
  );
}

/** Blocage dur (compte suspendu). */
export async function setChauffeurBlocked(
  chauffeurId: string,
  blocked: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_blocked: blocked },
    blocked ? "block_chauffeur" : "unblock_chauffeur"
  );
}
