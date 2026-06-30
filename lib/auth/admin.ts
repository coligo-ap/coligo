import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Vérif super-admin MÉMOÏSÉE par requête (React `cache`) : dans un même rendu,
 * le layout /admin ET la page (qui re-gate parfois) ne déclenchent qu'UN SEUL
 * appel `is_super_admin`.
 *
 * PERF : pas de `getUser()` réseau ici. La RPC `is_super_admin()` (SECURITY
 * DEFINER lisant `auth.jwt()->>'email'`) est la SOURCE DE VÉRITÉ — PostgREST
 * vérifie d'abord la signature + l'expiration du JWT, donc une session absente/
 * invalide ⇒ `false` (fail-closed). Le middleware a déjà rafraîchi/validé la
 * session AVANT ce rendu, donc le token est frais : un seul aller-retour suffit
 * (au lieu de getUser + rpc en série).
 */
const checkSuperAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_super_admin");
  return data === true;
});

/**
 * Super-admin : identifié par son email présent dans `platform_admins`.
 * La vérité est côté base (fonction SECURITY DEFINER `is_super_admin()` +
 * policies RLS). Ici on l'appelle pour gater les écrans/actions /admin.
 */
export async function isSuperAdmin(): Promise<boolean> {
  return checkSuperAdmin();
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
 *  - non connecté ou non super-admin → /portail (connexion super-admin dédiée)
 *  - super-admin avec MFA enrôlé mais session aal1 → /auth/mfa-challenge
 *
 * Le 2e check assure qu'un mot de passe seul ne suffit PAS dès que le
 * compte a activé la 2FA — c'est l'intérêt même du dispositif. La page
 * de challenge vit HORS /admin pour éviter une boucle de redirect (le
 * layout /admin appellerait ce même gate sur la page de challenge).
 */
export async function requireSuperAdmin(): Promise<void> {
  // PERF : la vérif admin (RPC, mémoïsée) et l'AAL (local, décode le JWT) sont
  // indépendantes → en parallèle. Coût ≈ 1 aller-retour réseau.
  const [ok, aal] = await Promise.all([checkSuperAdmin(), getAal()]);
  if (!ok) {
    redirect("/portail?error=forbidden");
  }
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/auth/mfa-challenge?next=%2Fadmin");
  }
}
