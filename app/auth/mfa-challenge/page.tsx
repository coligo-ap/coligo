import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaChallengeForm } from "@/components/admin/mfa-challenge-form";

export const dynamic = "force-dynamic";

/**
 * Page de challenge MFA — l'admin a entré son mot de passe (aal1) mais sa
 * session n'est pas encore aal2 ; on lui demande le code TOTP de Google
 * Authenticator pour finir l'auth.
 *
 * Cette page vit HORS de `/admin/*` exprès : `/admin/layout.tsx` appelle
 * `requireSuperAdmin()` qui redirige ici si aal2 manquant, et on ne veut
 * PAS de boucle.
 *
 * Gating minimal :
 *  - user connecté (sinon /login),
 *  - déjà à aal2 → on renvoie à /admin (rien à challenger),
 *  - sinon on rend le formulaire de code TOTP.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const params = await searchParams;
  // Sanitize next : seuls les chemins internes absolus, pas de //externe.
  const nextRaw = params.next ?? "/admin";
  const next =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/admin";

  if (aal?.currentLevel === "aal2") {
    redirect(next);
  }

  // Récupère le factor TOTP verified pour préparer le challenge côté client.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) {
    // Cas dégénéré : pas de factor verified mais nextLevel demande aal2 —
    // on laisse passer vers /admin (l'enroll a peut-être été supprimé en
    // direct base sans nettoyer la session).
    redirect(next);
  }

  return (
    <div className="bg-surface-2 flex min-h-screen items-center justify-center p-4">
      <div className="border-border w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">
          Vérification en 2 étapes
        </h1>
        <p className="text-muted mt-1 text-sm">
          Saisissez le code à 6 chiffres affiché par votre application
          d&apos;authentification (Google Authenticator, Authy, 1Password).
        </p>
        <MfaChallengeForm factorId={factor.id} next={next} />
      </div>
    </div>
  );
}
