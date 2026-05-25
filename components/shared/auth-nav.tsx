import Link from "next/link";
import { ArrowLeft, ShoppingBag, Store, User as UserIcon } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Bandeau de navigation MINIMAL pour les pages d'auth (commerçant et client).
 * Pas d'état client (auth/panier) — juste de la navigation statique pour que
 * l'utilisateur puisse revenir sur la marketplace ou switcher d'espace.
 */
export function AuthNavBar({
  variant,
}: {
  /** Espace courant : "merchant" = /login,/signup ; "customer" = /se-connecter,/inscription. */
  variant: "merchant" | "customer";
}) {
  return (
    <header className="border-border sticky top-0 z-30 border-b bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 lg:px-6">
        <Link href="/" className="shrink-0">
          <Logo variant="amber" size="sm" />
        </Link>

        <nav className="flex items-center gap-1 text-sm lg:gap-3">
          <Link
            href="/"
            className="text-muted hover:text-foreground hover:bg-surface-2 hidden items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium sm:inline-flex"
          >
            <ArrowLeft className="size-4" />
            Marketplace
          </Link>
          {variant === "merchant" ? (
            <Link
              href="/se-connecter"
              className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-medium lg:text-sm"
            >
              <UserIcon className="size-3.5" />
              Je suis client
            </Link>
          ) : (
            <Link
              href="/login"
              className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-medium lg:text-sm"
            >
              <Store className="size-3.5" />
              Je suis commerçant
            </Link>
          )}
          <Link
            href="/cart"
            className="hover:bg-surface-2 hidden rounded-full p-2 lg:inline-flex"
            aria-label="Panier"
          >
            <ShoppingBag className="size-5" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * Pied de page minimal : copyright + quelques liens utiles. Pas de scroll
 * lourd : on reste compact pour ne pas gêner la page d'auth.
 */
export function AuthFooter() {
  return (
    <footer className="border-border mt-auto border-t bg-white">
      <div className="text-muted mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs lg:px-6">
        <p>
          © {new Date().getFullYear()} {APP_CONFIG.name}. Tous droits réservés.
        </p>
        <nav className="flex flex-wrap gap-3">
          <Link href="/aide" className="hover:text-foreground">
            Aide
          </Link>
          <Link href="/cgu" className="hover:text-foreground">
            CGU
          </Link>
          <Link href="/confidentialite" className="hover:text-foreground">
            Confidentialité
          </Link>
          <a
            href={`mailto:${APP_CONFIG.contact.supportEmail}`}
            className="hover:text-foreground"
          >
            Support
          </a>
        </nav>
      </div>
    </footer>
  );
}
