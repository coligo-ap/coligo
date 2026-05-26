import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const dynamic = "force-dynamic";

/** Mot de passe oublié — flux CLIENT. */
export default function CustomerForgotPasswordPage() {
  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-10">
        <Link
          href="/se-connecter"
          className="text-muted inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Se connecter
        </Link>
        <header className="mt-4 mb-5 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Mot de passe oublié
          </h1>
          <p className="text-muted text-sm">
            Indique l&apos;email de ton compte Coligo. On t&apos;enverra un lien
            pour définir un nouveau mot de passe.
          </p>
        </header>
        <ForgotPasswordForm audience="customer" />
      </div>
    </CustomerShell>
  );
}
