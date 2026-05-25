import { createClient } from "@/lib/supabase/server";
import { MfaTotpManager } from "@/components/admin/mfa-totp-manager";

export const dynamic = "force-dynamic";

/**
 * Page sécurité admin — gestion 2FA TOTP (Google Authenticator, Authy, …).
 *
 * Server component : récupère la liste des factors TOTP déjà enrôlés pour
 * cet utilisateur (uniquement les factors `verified` comptent comme actifs).
 * Toute la mécanique enroll/verify/unenroll se fait côté client via le
 * browser client (les méthodes `auth.mfa.*` ont besoin de la session
 * courante côté navigateur).
 *
 * Le layout `/admin` gate déjà sur `requireSuperAdmin()`.
 */
export default async function AdminSecurityPage() {
  const supabase = await createClient();

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactors = factorsData?.totp ?? [];
  const activeFactor = totpFactors.find((f) => f.status === "verified") ?? null;

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Sécurité</h1>
        <p className="text-muted mt-1 text-sm">
          Vérification en deux étapes (2FA) pour ce compte super-admin.
        </p>
      </header>
      <MfaTotpManager
        activeFactor={
          activeFactor
            ? {
                id: activeFactor.id,
                friendlyName: activeFactor.friendly_name ?? null,
                createdAt: activeFactor.created_at,
              }
            : null
        }
      />
    </div>
  );
}
