"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bike, ClipboardList, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Barre de navigation basse de l'espace livreur (mobile-first), pour rendre la
 * navigation évidente sans passer par le menu burger. Onglet par défaut =
 * « Courses » (la page d'accueil `/driver` où arrivent les demandes en direct).
 *
 * Couleurs Coligo (violet de marque #5c5ce0 pour l'actif). Hauteur ~58 px : la
 * page d'accueil surélève d'autant son bottom-sheet pour ne pas le masquer.
 */
const ITEMS = [
  { href: "/driver", label: "Courses", icon: Bike, exact: true },
  { href: "/driver/gains", label: "Gains", icon: Wallet, exact: false },
  {
    href: "/driver/historique",
    label: "Historique",
    icon: ClipboardList,
    exact: false,
  },
  { href: "/driver/parametres", label: "Compte", icon: User, exact: false },
] as const;

export function DriverBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation livreur"
      className="fixed inset-x-0 bottom-0 z-[70] grid grid-cols-4 border-t border-black/10 bg-white pb-[max(env(safe-area-inset-bottom),0px)]"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold transition-colors",
              active ? "text-[#5c5ce0]" : "text-[#9e9e9e]"
            )}
          >
            <Icon
              className={cn("size-[22px]", active && "fill-[#5c5ce0]/10")}
              strokeWidth={active ? 2.4 : 2}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
