"use client";

import { BarChart3, Home, User } from "lucide-react";
import { PartnerTabbar, type PartnerTab } from "@/components/shared/partner-ui";
import { useLocale } from "next-intl";

/**
 * Barre d'onglets persistante livreur (Accueil · Gains · Historique ·
 * Coligo Pay · Compte) — rendue par la primitive PARTAGÉE `PartnerTabbar`
 * (même composant et même hauteur 66 px que l'espace chauffeur : parité
 * maquette complète, la feuille d'accueil ayant été remplacée par la barre
 * de mise en ligne dockée).
 */
// HUB ARGENT : Gains/Courses/Coligo Pay vivent dans UNE page à onglets
// (MoneyTabs) → la nav basse se simplifie à 3 entrées, l'onglet Gains reste
// actif sur toutes les sous-routes du hub.
const ITEMS: readonly PartnerTab[] = [
  {
    href: "/driver",
    label: "Accueil",
    labelAr: "الرئيسية",
    icon: Home,
    exact: true,
  },
  {
    href: "/driver/gains",
    label: "Gains",
    labelAr: "الأرباح",
    icon: BarChart3,
    match: ["/driver/historique", "/driver/recharger", "/driver/releve"],
  },
  {
    href: "/driver/parametres",
    label: "Compte",
    labelAr: "الحساب",
    icon: User,
  },
];

export function DriverBottomNav() {
  const isAr = useLocale() === "ar";
  return (
    <PartnerTabbar
      items={ITEMS}
      height={66}
      ariaLabel={isAr ? "تنقّل السائق" : "Navigation livreur"}
    />
  );
}
