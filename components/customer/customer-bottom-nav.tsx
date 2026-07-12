"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, CircleUserRound, House, ReceiptText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

// Nav Coligo (PROMPT Drive §1) : Accueil · Commandes · Drive · Pay · Compte.
// Icônes ALIGNÉES sur la tab bar Bolt Food (capture réelle) : maison à porte,
// REÇU à zigzag pour les commandes (leur « Orders »), personne dans un cercle
// pour le compte. Drive/Pay restent propres à Coligo (voiture / portefeuille).
const ITEMS = [
  { href: "/", key: "home", icon: House },
  { href: "/commandes", key: "orders", icon: ReceiptText },
  { href: "/drive", key: "drive", icon: Car },
  { href: "/coligo-pay", key: "pay", icon: Wallet },
  { href: "/compte", key: "account", icon: CircleUserRound },
] as const;

/**
 * `hiddenKeys` : onglets retirés (fonctionnalité masquée par le super-admin,
 * ex. ["drive"], ["pay"]). La grille s'ajuste au nombre d'onglets restants.
 */
export function CustomerBottomNav({
  hiddenKeys = [],
}: {
  hiddenKeys?: string[];
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const items = ITEMS.filter((i) => !hiddenKeys.includes(i.key));

  return (
    <nav
      aria-label="Navigation principale"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="border-border bg-surface fixed inset-x-0 bottom-0 z-30 grid border-t pb-[max(env(safe-area-inset-bottom),0px)] lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            className={cn(
              // Icônes GRANDES façon Bolt (26 px) et padding réduit : l'espace
              // du composant sert à l'icône, pas à de l'air (règle produit).
              "flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] transition-colors",
              active ? "text-primary-700" : "text-muted hover:text-foreground"
            )}
          >
            <Icon className="size-[26px]" strokeWidth={active ? 2.4 : 1.8} />
            <span
              className={cn(
                "leading-none",
                active ? "font-bold" : "font-medium"
              )}
            >
              {t(item.key)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
