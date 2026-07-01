"use client";

import { BarChart3, Clock, Home, User, Wallet } from "lucide-react";
import { PartnerTabbar, type PartnerTab } from "@/components/shared/partner-ui";
import { useLocale } from "next-intl";

/**
 * Barre d'onglets persistante livreur (Accueil · Gains · Historique ·
 * Coligo Pay · Compte) — désormais rendue par la primitive PARTAGÉE
 * `PartnerTabbar` (même composant que l'espace chauffeur, tokens `--d-*`
 * aliasés sur la palette livreur). Hauteur 74 px conservée : la feuille
 * d'accueil (.mq-sheet) est calée dessus (bottom: 74px).
 */
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
  },
  {
    href: "/driver/historique",
    label: "Historique",
    labelAr: "السجل",
    icon: Clock,
  },
  {
    href: "/driver/recharger",
    label: "Coligo Pay",
    labelAr: "كوليغو باي",
    icon: Wallet,
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
      height={74}
      ariaLabel={isAr ? "تنقّل السائق" : "Navigation livreur"}
    />
  );
}
