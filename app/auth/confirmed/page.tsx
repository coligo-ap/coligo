import Link from "next/link";
import { CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { createClient } from "@/lib/supabase/server";
import { APP_CONFIG } from "@/lib/config/app-config";

export const metadata = {
  title: `Inscription confirmée — ${APP_CONFIG.name}`,
};

export default async function ConfirmedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = !!user;
  const cta = isLoggedIn
    ? { href: "/dashboard", label: "Accéder à mon espace" }
    : { href: "/login", label: "Se connecter" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-surface-2 to-primary-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo variant="teal" size="lg" />
        </div>

        <div className="bg-white rounded-[20px] border border-border shadow-lg p-8 lg:p-10 text-center">
          <div className="mx-auto mb-6 size-20 rounded-full bg-green-100 flex items-center justify-center relative">
            <CheckCircle2 className="size-12 text-green-600" strokeWidth={2.2} />
            <Sparkles className="absolute -top-1 -right-1 size-5 text-primary-500" />
          </div>

          <h1 className="text-2xl lg:text-3xl font-bold text-foreground mb-2 tracking-tight">
            Inscription confirmée
          </h1>
          <p className="text-muted mb-1">
            Votre compte commerçant a bien été activé.
          </p>
          <p className="text-subtle text-sm mb-8">
            Bienvenue sur {APP_CONFIG.name} — vous pouvez maintenant accéder à votre espace.
          </p>

          <Link
            href={cta.href}
            className={buttonVariants({ size: "lg", className: "w-full" })}
          >
            {cta.label}
            <ArrowRight className="size-4" />
          </Link>

          <p className="text-xs text-muted mt-6">
            Besoin d&apos;aide ?{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="text-primary-700 hover:underline font-medium"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>
          </p>
        </div>

        <p className="text-xs text-subtle text-center mt-6">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </div>
    </div>
  );
}
