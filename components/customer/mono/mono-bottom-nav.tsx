"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, CircleUserRound, House, ReceiptText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// MonoBottomNav — barre du bas du thème « bold minimalism ».
//
// Pilule FLOTTANTE détachée du bord (16 px tout autour), fond blanc, ombre
// portée : c'est l'unique élévation du thème, et elle est FONCTIONNELLE (la
// barre survole le contenu qui défile dessous).
//
// Onglet actif : pilule interne gris chaud + icône et libellé en --brand.
// Onglet inactif : --ink plein (jamais un gris pâle : on ne hiérarchise pas
// par la couleur du texte).
//
// Zone sûre : la barre remonte de l'inset système en PLUS des 16 px — jamais
// `max(16px, env(...))`, qui collerait la barre au bord dès que l'inset grandit.
// =============================================================================

const ITEMS = [
  { key: "home", href: "/", label: "Accueil", icon: House },
  { key: "orders", href: "/commandes", label: "Commandes", icon: ReceiptText },
  { key: "drive", href: "/drive", label: "Drive", icon: Car },
  { key: "pay", href: "/coligo-pay", label: "Pay", icon: Wallet },
  { key: "account", href: "/compte", label: "Compte", icon: CircleUserRound },
] as const;

export function MonoBottomNav({
  counts = {},
}: {
  /** Compteurs par onglet (panier, commandes en cours…). */
  counts?: Partial<Record<(typeof ITEMS)[number]["key"], number>>;
}) {
  const pathname = usePathname() || "/";
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-4 z-30 grid grid-cols-5 rounded-[var(--radius-pill)] bg-[var(--surface-card)] p-1 shadow-[var(--shadow-nav)]"
      style={{ bottom: "calc(16px + env(safe-area-inset-bottom))" }}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        // Le hub /services reste rattaché à l'onglet Accueil (page de démarrage).
        const on =
          item.href === "/"
            ? pathname === "/" || pathname === "/services"
            : pathname.startsWith(item.href);
        const count = counts[item.key] ?? 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-pill)] px-0.5 py-2 transition-colors",
              on ? "bg-[var(--surface-section-a)]" : "bg-transparent"
            )}
          >
            <span className="relative">
              <Icon
                aria-hidden
                className={cn(
                  "size-6",
                  on ? "text-[var(--brand)]" : "text-[var(--ink)]"
                )}
                strokeWidth={on ? 2.4 : 1.9}
              />
              {count > 0 && (
                <span className="text-label absolute -end-2 -top-1.5 grid size-5 place-items-center rounded-[var(--radius-pill)] bg-[var(--counter)] leading-none font-bold text-[var(--surface-card)]">
                  {count}
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-micro max-w-full truncate leading-none font-medium",
                on ? "text-[var(--brand)]" : "text-[var(--ink)]"
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
