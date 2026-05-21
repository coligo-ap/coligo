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
    <div className="from-primary-50 via-surface-2 to-primary-100 flex min-h-screen items-center justify-center bg-gradient-to-br p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="teal" size="lg" />
        </div>

        <div className="border-border rounded-[20px] border bg-white p-8 text-center shadow-lg lg:p-10">
          <div className="relative mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2
              className="size-12 text-green-600"
              strokeWidth={2.2}
            />
            <Sparkles className="text-primary-500 absolute -top-1 -right-1 size-5" />
          </div>

          <h1 className="text-foreground mb-2 text-2xl font-bold tracking-tight lg:text-3xl">
            Inscription confirmée
          </h1>
          <p className="text-muted mb-1">
            Votre compte commerçant a bien été activé.
          </p>
          <p className="text-subtle mb-8 text-sm">
            Bienvenue sur {APP_CONFIG.name} — vous pouvez maintenant accéder à
            votre espace.
          </p>

          <Link
            href={cta.href}
            className={buttonVariants({ size: "lg", className: "w-full" })}
          >
            {cta.label}
            <ArrowRight className="size-4" />
          </Link>

          <p className="text-muted mt-6 text-xs">
            Besoin d&apos;aide ?{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="text-primary-700 font-medium hover:underline"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>
          </p>
        </div>

        <p className="text-subtle mt-6 text-center text-xs">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </div>
    </div>
  );
}
