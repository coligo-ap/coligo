"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { locate } from "@/lib/admin/navigation";

// =============================================================================
// FIL D'ARIANE du super-admin — Domaine › Section › Page, dérivé du plan unique.
//
// Dans un dashboard de 60 pages, la question « où suis-je, et comment je remonte »
// se pose tout le temps. Le fil vit dans l'en-tête (toujours visible, jamais un
// bloc de plus dans la page), et le domaine est cliquable : un tap pour revenir
// au hub. Sur mobile, on ne garde que la page courante — l'espace y est compté.
// =============================================================================

export function AdminBreadcrumb() {
  const pathname = usePathname();
  const here = locate(pathname);
  if (!here) return null;

  const { item, domain, section } = here;
  // La racine d'un domaine se suffit à elle-même : « Pilotage › Pilotage » ne
  // dit rien de plus que « Pilotage ».
  const showDomain = item.href !== domain.href;

  return (
    <nav
      aria-label="Fil d'Ariane"
      className="text-muted hidden min-w-0 items-center gap-1 text-sm sm:flex"
    >
      {showDomain && (
        <>
          <Link
            href={domain.href}
            className="hover:text-foreground shrink-0 transition-colors"
          >
            {domain.label}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 opacity-50" />
          {section && (
            <>
              <span className="hidden shrink-0 lg:inline">{section}</span>
              <ChevronRight className="hidden size-3.5 shrink-0 opacity-50 lg:inline" />
            </>
          )}
        </>
      )}
      <span className="text-foreground truncate font-semibold">
        {item.label}
      </span>
    </nav>
  );
}
