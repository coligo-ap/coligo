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
      className="border-border bg-surface fixed inset-x-0 bottom-0 z-30 grid border-t pb-[calc(0px+env(safe-area-inset-bottom))] lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        // Onglet DRIVE mis en avant (« héros ») : au centre de la barre, il ne
        // se fond pas dans les icônes plates — pastille en dégradé violet de
        // marque, léger relief + halo qui respire pour inviter à DÉCOUVRIR la
        // course, et un micro-badge « VTC » qui dit d'un coup d'œil que Drive
        // c'est aussi le transport de personnes. Hauteur du slot identique aux
        // autres (26 px) → la barre ne grandit pas, les libellés restent alignés.
        if (item.key === "drive") {
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-label={`${t("drive")} · VTC`}
              className="relative flex flex-col items-center justify-center gap-1 py-1.5 text-[11px]"
            >
              <span className="relative flex h-[26px] w-full items-center justify-center">
                <span className="absolute -top-2 left-1/2 grid -translate-x-1/2 place-items-center">
                  {/* Halo « découvrez » — anneau doux qui pulse (masqué si
                      l'utilisateur est déjà sur Drive : plus besoin d'inviter). */}
                  {!active && (
                    <span
                      aria-hidden
                      className="bg-primary-500/25 co-nav-beacon absolute inset-0 rounded-[14px]"
                    />
                  )}
                  <span
                    className={cn(
                      "from-primary-500 to-primary-700 relative grid size-9 place-items-center rounded-[14px] bg-gradient-to-br text-white ring-1 ring-white/20 transition-shadow",
                      active
                        ? "shadow-primary-700/40 shadow-lg"
                        : "shadow-primary-700/30 shadow-md"
                    )}
                  >
                    <Car
                      className="size-[22px] rtl:-scale-x-100"
                      strokeWidth={2.3}
                    />
                  </span>
                  {/* Badge VTC : dit que Drive = aussi transport de personnes. */}
                  <span
                    aria-hidden
                    className="bg-coral-500 absolute -end-2 -top-1.5 rounded-full px-1 text-[8px] leading-[14px] font-black text-white shadow-sm ring-1 ring-white/80"
                  >
                    {t("driveTag")}
                  </span>
                </span>
              </span>
              <span className="text-primary-700 leading-none font-bold">
                {t("drive")}
              </span>
            </Link>
          );
        }

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
