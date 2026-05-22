import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Super-admin : identifié par son email présent dans `platform_admins`.
 * La vérité est côté base (fonction SECURITY DEFINER `is_super_admin()` +
 * policies RLS). Ici on l'appelle pour gater les écrans/actions /admin.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.rpc("is_super_admin");
  return data === true;
}

/** À appeler en tête des pages/actions /admin : redirige si non super-admin. */
export async function requireSuperAdmin(): Promise<void> {
  if (!(await isSuperAdmin())) {
    redirect("/login?error=forbidden");
  }
}
