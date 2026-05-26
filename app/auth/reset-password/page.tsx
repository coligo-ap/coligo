import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";

/**
 * Page atterissage du lien email "Réinitialiser mon mot de passe".
 *
 * Supabase auth installe automatiquement une session temporaire de type
 * "recovery" via le code dans le hash de l'URL. Le form ci-dessous appelle
 * `auth.updateUser({password})` qui agit sur cette session.
 *
 * On accepte un paramètre `audience` (merchant / customer) pour adapter le
 * lien de retour après succès vers l'écran de login correspondant.
 */
export default function ResetPasswordPage() {
  return (
    <div className="bg-surface-2 min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Nouveau mot de passe
          </h1>
          <p className="text-muted text-sm">
            Choisis un nouveau mot de passe pour ton compte.
          </p>
        </header>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
        <p className="text-muted text-center text-xs">
          <Link href="/" className="underline">
            Retour à l&apos;accueil
          </Link>
        </p>
      </div>
    </div>
  );
}
