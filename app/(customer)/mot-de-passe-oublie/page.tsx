import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const dynamic = "force-dynamic";

/** Mot de passe oublié — flux CLIENT. */
export default async function CustomerForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-10">
        <Link
          href="/se-connecter"
          className="text-muted inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> {t("signIn")}
        </Link>
        <header className="mt-4 mb-5 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("forgotPassword")}
          </h1>
          <p className="text-muted text-sm">{t("forgotPasswordIntro")}</p>
        </header>
        <ForgotPasswordForm audience="customer" />
      </div>
    </CustomerShell>
  );
}
