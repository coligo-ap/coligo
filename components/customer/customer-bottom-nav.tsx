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
  { href: "/services", key: "home", icon: House },
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
      // Feuille blanche à COINS HAUTS ARRONDIS, sans filet (maquette v2 de
      // l'accueil) : le contenu passe DESSOUS, la courbe fait la séparation.
      className="bg-surface rounded-t-panel fixed inset-x-0 bottom-0 z-30 grid pb-[calc(0px+env(safe-area-inset-bottom))] lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        // ACCUEIL = le hub /services (page de démarrage de l'app). Il reste
        // allumé sur la marketplace « / », qui n'est plus qu'un univers filtré
        // ouvert depuis une tuile du hub.
        const active =
          item.key === "home"
            ? pathname === "/services" || pathname === "/"
            : pathname.startsWith(item.href);

        // Onglet DRIVE mis en avant : au centre de la barre, un CERCLE PLEIN
        // violet de marque — AUCUN relief, AUCUNE ombre — avec la voiture en
        // blanc dedans (maquette v2 de l'accueil). Hauteur du slot identique
        // aux autres (26 px) → la barre ne grandit pas, les libellés restent
        // alignés.
        if (item.key === "drive") {
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-label={t("drive")}
              className="text-caption relative flex flex-col items-center justify-center gap-1 py-1.5"
            >
              <span className="relative flex h-[26px] w-full items-center justify-center">
                <span className="bg-primary-600 text-on-brand absolute -top-2.5 left-1/2 grid size-10 -translate-x-1/2 place-items-center rounded-full">
                  <Car className="size-[22px]" strokeWidth={2} />
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
              "text-caption flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-1.5 transition-colors",
              active ? "text-primary-700" : "text-muted hover:text-foreground"
            )}
          >
            <Icon
              className={cn(
                "size-[26px] shrink-0",
                // Accueil actif : maison PLEINE avec la porte évidée (maquette
                // v2). Le premier tracé de l'icône lucide EST la porte — on la
                // repeint à la couleur de la barre pour obtenir l'encoche.
                active &&
                  item.key === "home" &&
                  "[&>path:first-child]:fill-surface [&>path:first-child]:stroke-surface fill-current"
              )}
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
