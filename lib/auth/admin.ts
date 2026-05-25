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

/**
 * Vérifie l'AAL de la session courante.
 *
 *  - `currentLevel` : niveau actuel atteint par les facteurs présents dans la
 *    session (aal1 = mot de passe seul, aal2 = mot de passe + 2FA).
 *  - `nextLevel`    : niveau requis par l'utilisateur (si MFA enrôlé →
 *    `aal2`, sinon `aal1`).
 *
 * Si `currentLevel !== nextLevel`, l'utilisateur doit fournir le code TOTP
 * via `/admin/mfa-challenge` avant d'accéder aux pages /admin sensibles.
 */
export async function getAal(): Promise<{
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    currentLevel:
      (data?.currentLevel as "aal1" | "aal2" | null | undefined) ?? null,
    nextLevel: (data?.nextLevel as "aal1" | "aal2" | null | undefined) ?? null,
  };
}

/**
 * À appeler en tête des pages/actions /admin :
 *  - non connecté ou non super-admin → /login
 *  - super-admin avec MFA enrôlé mais session aal1 → /auth/mfa-challenge
 *
 * Le 2e check assure qu'un mot de passe seul ne suffit PAS dès que le
 * compte a activé la 2FA — c'est l'intérêt même du dispositif. La page
 * de challenge vit HORS /admin pour éviter une boucle de redirect (le
 * layout /admin appellerait ce même gate sur la page de challenge).
 */
export async function requireSuperAdmin(): Promise<void> {
  if (!(await isSuperAdmin())) {
    redirect("/login?error=forbidden");
  }
  const { currentLevel, nextLevel } = await getAal();
  if (nextLevel === "aal2" && currentLevel !== "aal2") {
    redirect("/auth/mfa-challenge?next=%2Fadmin");
  }
}
