import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const dynamic = "force-dynamic";

/** Mot de passe oublié — flux COMMERÇANT. */
export default function MerchantForgotPasswordPage() {
  return (
    <div className="bg-surface-2 min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <Link
          href="/login"
          className="text-muted inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Connexion commerçant
        </Link>
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Mot de passe oublié
          </h1>
          <p className="text-muted text-sm">
            Indique l&apos;email associé à ta boutique. On t&apos;enverra un
            lien pour définir un nouveau mot de passe.
          </p>
        </header>
        <ForgotPasswordForm audience="merchant" />
      </div>
    </div>
  );
}
