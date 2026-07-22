import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AlertDomain } from "@/lib/alerts/alert-model";

/** Un « scope » d'admin = un des 8 domaines fonctionnels (mêmes clés que le
 *  moteur d'alertes / ADMIN_DOMAINS). */
export type AdminScope = AlertDomain;

/** Les 8 domaines, dans l'ordre de la nav (owner = tous). Sert de fallback pour
 *  choisir la page d'atterrissage d'un staff scopé. */
export const ADMIN_SCOPES: AdminScope[] = [
  "pilotage",
  "commercants",
  "livraison",
  "drive",
  "clients",
  "finances",
  "confiance",
  "plateforme",
  "marketing",
];

/** Route d'atterrissage de chaque domaine (1er hit de son hub). */
export const ADMIN_SCOPE_HOME: Record<AdminScope, string> = {
  pilotage: "/admin",
  commercants: "/admin/merchants",
  livraison: "/admin/drivers",
  drive: "/admin/chauffeurs",
  clients: "/admin/clients",
  finances: "/admin/coligo-pay",
  confiance: "/admin/reports",
  plateforme: "/admin/controle",
  marketing: "/admin/marketing",
};

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

/** Contexte RBAC de la session admin courante. */
export type AdminContext = {
  isAdmin: boolean;
  isOwner: boolean;
  domains: AdminScope[];
};

/**
 * Contexte admin de la session (rôle + domaines autorisés), MÉMOÏSÉ par requête.
 * Un seul appel `current_admin()` (SECURITY DEFINER) pour tout un rendu — le
 * layout /admin, la nav et chaque gate de hub le réutilisent sans re-requêter.
 * Fail-closed : toute erreur ⇒ non-admin sans domaine.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = await createClient();
  // `current_admin` renvoie une TABLE (0 ou 1 ligne) → premier élément.
  const { data } = await supabase.rpc("current_admin" as never);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { is_admin?: boolean; is_owner?: boolean; domains?: string[] | null }
    | null
    | undefined;
  if (!row?.is_admin) return { isAdmin: false, isOwner: false, domains: [] };
  const domains = (row.domains ?? []).filter((d): d is AdminScope =>
    (ADMIN_SCOPES as string[]).includes(d)
  );
  return {
    isAdmin: true,
    isOwner: row.is_owner === true,
    domains,
  };
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
 * Ce staff/owner a-t-il accès au DOMAINE `scope` ? owner ⇒ toujours ; staff ⇒
 * uniquement si le domaine figure dans sa liste. À utiliser dans les server
 * actions (`if (!(await adminCan('livraison'))) return { error: ... }`).
 */
export async function adminCan(scope: AdminScope): Promise<boolean> {
  const ctx = await getAdminContext();
  return ctx.isOwner || ctx.domains.includes(scope);
}

/** Owner (gestion des admins) ? */
export async function isOwner(): Promise<boolean> {
  return (await getAdminContext()).isOwner;
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

/**
 * Gate d'un HUB de domaine (à appeler en tête de chaque `layout.tsx` de domaine).
 * S'appuie sur `requireSuperAdmin()` déjà exécuté par le layout /admin parent
 * (session admin + MFA garantis). Ici on ne vérifie QUE le scope :
 *   - owner ou staff autorisé → passe.
 *   - staff NON autorisé → redirigé vers la page d'atterrissage de son 1er
 *     domaine (jamais un écran vide/403 brut : on l'emmène là où il a le droit).
 *   - aucun domaine (ne devrait pas arriver) → /portail.
 */
export async function requireAdminDomain(scope: AdminScope): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.isAdmin) redirect("/portail?error=forbidden");
  if (ctx.isOwner || ctx.domains.includes(scope)) return;
  const fallback = ADMIN_SCOPES.find((s) => ctx.domains.includes(s));
  redirect(fallback ? ADMIN_SCOPE_HOME[fallback] : "/portail?error=forbidden");
}

/** Gate OWNER-only (gestion des admins). Un staff est renvoyé sur son domaine. */
export async function requireOwner(): Promise<void> {
  const ctx = await getAdminContext();
  if (ctx.isOwner) return;
  const fallback = ADMIN_SCOPES.find((s) => ctx.domains.includes(s));
  redirect(fallback ? ADMIN_SCOPE_HOME[fallback] : "/portail?error=forbidden");
}
