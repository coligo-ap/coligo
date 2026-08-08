import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Page courante (1-indexée). */
  page: number;
  /** Nombre total de pages (>= 1). */
  pageCount: number;
  /** Construit l'URL pour une page donnée (ex. `?page=N` ou `?status=ready&page=N`). */
  hrefFor: (page: number) => string;
  /** Total d'items (affiché en libellé optionnel). */
  total?: number;
  /** Libellé sing/plur (ex. « commande », « écriture »). */
  itemLabel?: { singular: string; plural: string };
  className?: string;
};

/**
 * Pagination URL-based : chaque bouton est un `<Link>`. Server-friendly,
 * partageable, supportée par le bouton retour. Pas d'état client.
 *
 * Affiche : « Précédent / 1 … 4 [5] 6 … 12 / Suivant » sur desktop ;
 * « ◀ Page X / N ▶ » compact sur mobile.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  total,
  itemLabel,
  className,
}: Props) {
  if (pageCount <= 1) {
    if (total != null && itemLabel) {
      return (
        <p
          className={cn("text-muted text-xs tabular-nums", className)}
          aria-live="polite"
        >
          {total} {total > 1 ? itemLabel.plural : itemLabel.singular}
        </p>
      );
    }
    return null;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  const pages = buildPageList(page, pageCount);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className
      )}
    >
      {total != null && itemLabel && (
        <p className="text-muted text-xs tabular-nums">
          {total} {total > 1 ? itemLabel.plural : itemLabel.singular}
        </p>
      )}

      <div className="flex items-center gap-1">
        <PageLink
          href={hrefFor(Math.max(1, page - 1))}
          disabled={prevDisabled}
          aria-label="Page précédente"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Précédent</span>
        </PageLink>

        {/* Compact mobile : « Page X / N » */}
        <span className="text-muted px-2 text-xs tabular-nums sm:hidden">
          {page} / {pageCount}
        </span>

        {/* Détaillé desktop : numéros de page */}
        <div className="hidden items-center gap-1 sm:flex">
          {pages.map((p, i) =>
            p === null ? (
              <span
                key={`gap-${i}`}
                className="text-subtle px-1.5 text-xs select-none"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <PageLink
                key={p}
                href={hrefFor(p)}
                active={p === page}
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </PageLink>
            )
          )}
        </div>

        <PageLink
          href={hrefFor(Math.min(pageCount, page + 1))}
          disabled={nextDisabled}
          aria-label="Page suivante"
        >
          <span className="hidden sm:inline">Suivant</span>
          <ChevronRight className="size-4" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  active,
  disabled,
  children,
  ...rest
}: {
  href: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLAnchorElement>, "children" | "href">) {
  const className = cn(
    "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm border px-2 text-xs font-medium transition-colors",
    active
      ? "border-primary-600 bg-primary-600 text-white"
      : disabled
        ? "border-border bg-surface-3 text-subtle pointer-events-none"
        : "border-border-strong bg-white text-foreground hover:bg-surface-2"
  );
  if (disabled) {
    return (
      <span aria-disabled="true" className={className} {...rest}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} prefetch={false} className={className} {...rest}>
      {children}
    </Link>
  );
}

/**
 * Construit la liste à afficher : 1 … (current-1, current, current+1) … last.
 * `null` = ellipsis. On garde toujours 1 et last + une fenêtre autour de la
 * page courante (max ~7 boutons sur desktop).
 */
function buildPageList(current: number, total: number): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const window = new Set<number>([1, total, current - 1, current, current + 1]);
  // Ajoute deux ancres pour éviter l'ellipse seule à un seul bond.
  if (current <= 4) {
    window.add(2);
    window.add(3);
    window.add(4);
  }
  if (current >= total - 3) {
    window.add(total - 1);
    window.add(total - 2);
    window.add(total - 3);
  }
  const sorted = Array.from(window)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let i = 0; i < sorted.length; i++) {
    out.push(sorted[i]);
    if (i < sorted.length - 1 && sorted[i + 1] - sorted[i] > 1) out.push(null);
  }
  return out;
}
