import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Coque des SOUS-PAGES agent : en-tête « retour + titre », largeur et zone
 * sûre identiques au hub. Une seule coque pour toutes les sous-pages → elles
 * se ressemblent, et une correction vaut pour toutes.
 *
 * Le retour est un `<Link>` (jamais `router.back()`) : arriver directement sur
 * `/partenaire/vendre` par un lien ou une notification doit ramener au hub,
 * pas hors de l'application.
 */
export function PartnerSubPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <Link
          href="/partenaire"
          prefetch
          aria-label="Retour"
          className="border-border text-foreground hover:bg-surface-2 grid size-9 shrink-0 place-items-center rounded-full border transition-colors"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-foreground text-title-lg truncate font-extrabold">
            {title}
          </h1>
          {subtitle && (
            <p className="text-muted truncate text-xs font-semibold">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
