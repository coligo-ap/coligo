import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowLeft, Lock, ShoppingCart, User as UserIcon } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";
import { PartnerSheetButton } from "@/components/shared/partner-sheet";

/**
 * Bandeau de navigation MINIMAL pour les pages d'auth (commerçant, client,
 * livreur). Pas d'état client (auth/panier) — juste de la navigation
 * statique pour que l'utilisateur puisse revenir sur la marketplace ou
 * switcher d'espace.
 */
/** Espace d'auth courant. Tous sauf "customer" affichent le raccourci « Je
 *  suis client » ; le rendu visuel du bandeau est IDENTIQUE pour tous. */
export type AuthVariant =
  | "merchant"
  | "customer"
  | "driver"
  | "chauffeur"
  | "partner";

export function AuthNavBar({
  variant,
}: {
  /** Espace courant : "merchant" = /login,/signup ; "customer" = /se-connecter,/inscription ; "driver" = /driver/login,/driver/signup ; "chauffeur" = /chauffeur/* ; "partner" = /partenaire/*. */
  variant: AuthVariant;
}) {
  // Isomorphe (useLocale, jamais getLocale) : importé par des pages CLIENT
  // (« use client ») comme par les portails serveur — cf. incident #419.
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <header className="border-border sticky top-0 z-30 border-b bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 lg:px-6">
        <Link href="/" className="shrink-0">
          <Logo variant="amber" size="sm" />
        </Link>

        <nav className="flex items-center gap-1 text-sm lg:gap-3">
          <Link
            href="/"
            className="text-muted hover:text-foreground hover:bg-surface-2 rounded-control hidden items-center gap-1.5 px-3 py-1.5 font-medium sm:inline-flex"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {tr("Marketplace", "السوق")}
          </Link>
          {/* Switch de rôle unifié sur tous les portails : on ne garde QUE
              « Je suis client » (sauf sur le portail client lui-même) ; tous
              les autres profils (commerçant, chauffeur, livreur, Agent Coligo
              Pay) sont regroupés dans la feuille « Devenir partenaire ». */}
          {variant !== "customer" && (
            <Link
              href="/se-connecter"
              className="border-border hover:bg-surface-2 rounded-control inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium lg:text-sm"
            >
              <UserIcon className="size-3.5" />
              {tr("Je suis client", "أنا زبون")}
            </Link>
          )}
          <PartnerSheetButton />
          <Link
            href="/cart"
            className="hover:bg-surface-2 hidden rounded-full p-2 lg:inline-flex"
            aria-label={tr("Panier", "السلة")}
          >
            <ShoppingCart className="size-5" />
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
export function AuthFooter({
  showPortal = false,
}: {
  /** Affiche le lien discret vers le portail super-admin (page login
   *  commerçant uniquement — jamais sur les pages grand public). */
  showPortal?: boolean;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Safe-area BAS (APK edge-to-edge) : le fond blanc se prolonge sous la
  // barre système/gestes, les liens (Aide, CGU, Support…) restent AU-DESSUS —
  // sinon ils sont cachés derrière les boutons du téléphone. Toujours
  // calc(env()+x), jamais max() (règle zones sûres).
  return (
    <footer className="border-border mt-auto border-t bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="text-muted mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-4 text-xs lg:px-6 lg:pb-3">
        <p>
          © {new Date().getFullYear()} {APP_CONFIG.name}.{" "}
          {tr("Tous droits réservés.", "جميع الحقوق محفوظة.")}
        </p>
        <nav className="flex flex-wrap items-center gap-3">
          {/* Centre d'aide PUBLIC — « /aide » est la page de l'ESPACE
              COMMERÇANT (groupe protégé) : un visiteur y était renvoyé vers
              le login commerçant (bug repéré au balayage du 06/08). */}
          <Link href="/centre-aide" className="hover:text-foreground">
            {tr("Aide", "المساعدة")}
          </Link>
          <Link href="/cgu" className="hover:text-foreground">
            {tr("CGU", "الشروط العامة")}
          </Link>
          <Link href="/confidentialite" className="hover:text-foreground">
            {tr("Confidentialité", "الخصوصية")}
          </Link>
          <a
            href={`mailto:${APP_CONFIG.contact.supportEmail}`}
            className="hover:text-foreground"
          >
            {tr("Support", "الدعم")}
          </a>
          {showPortal && (
            <Link
              href="/portail"
              className="text-subtle hover:text-foreground inline-flex items-center gap-1"
            >
              <Lock className="size-3" />
              Portail
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
