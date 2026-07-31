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

        // Onglet DRIVE mis en avant : au centre de la barre, un CERCLE PLAT en
        // dégradé violet→rose de marque — AUCUN relief, AUCUNE ombre, aucun
        // effet — rempli par la Tesla des cartes (sprite vu de dessus), avec un
        // tag ambre « Nouveau » en haut de la voiture pour inviter à découvrir
        // la course / le VTC. Hauteur du slot identique aux autres (26 px) → la
        // barre ne grandit pas, les libellés restent alignés.
        if (item.key === "drive") {
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-label={`${t("drive")} · ${t("driveTag")}`}
              className="relative flex flex-col items-center justify-center gap-1 py-1.5 text-[11px]"
            >
              <span className="relative flex h-[26px] w-full items-center justify-center">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2">
                  {/* Cercle PLAT dégradé violet→rose Coligo (pas d'ombre, pas de
                      relief). La Tesla blanche des cartes le remplit. */}
                  <span className="from-primary-600 via-primary-400 relative grid size-9 place-items-center overflow-hidden rounded-full bg-gradient-to-br to-[#FF2D7A]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/drive/vehicles/voiture-coligo-white.png"
                      alt=""
                      width={44}
                      height={44}
                      className="size-[44px] object-contain rtl:-scale-x-100"
                    />
                  </span>
                  {/* Tag « Nouveau » ambre, posé en haut de la voiture. */}
                  <span
                    aria-hidden
                    className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-1 text-[8px] leading-[13px] font-black text-[#4a2e00] ring-1 ring-white/80"
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
              // `min-w-0` + libellé `truncate` : police système agrandie ⇒
              // le libellé se tronque au lieu de déborder sur le voisin.
              "flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-[11px] transition-colors",
              active ? "text-primary-700" : "text-muted hover:text-foreground"
            )}
          >
            <Icon
              className="size-[26px] shrink-0"
              strokeWidth={active ? 2.4 : 1.8}
            />
            <span
              className={cn(
                "max-w-full truncate leading-none",
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
