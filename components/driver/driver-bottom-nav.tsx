"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

const LABELS_AR: Record<string, string> = {
  Accueil: "الرئيسية",
  Gains: "الأرباح",
  Historique: "السجل",
  Compte: "الحساب",
};

/**
 * Barre d'onglets persistante (Accueil · Gains · Historique · Compte) reproduite
 * À L'IDENTIQUE de MAQUETTE-livreur-pages / navigation (classes .mq-tabbar /
 * .mq-tab + SVG exacts). Couleur active = violet maquette (--violet #5B5BE6).
 */
const ITEMS = [
  {
    href: "/driver",
    label: "Accueil",
    exact: true,
    path: "M3 11l9-8 9 8M5 10v10h14V10",
  },
  {
    href: "/driver/gains",
    label: "Gains",
    exact: false,
    path: "M3 3v18h18M7 14l3-4 3 3 4-6",
  },
  {
    href: "/driver/historique",
    label: "Historique",
    exact: false,
    path: "",
    clock: true,
  },
  {
    href: "/driver/parametres",
    label: "Compte",
    exact: false,
    path: "",
    user: true,
  },
] as const;

export function DriverBottomNav() {
  const pathname = usePathname();
  const isAr = useLocale() === "ar";

  return (
    <nav
      className="mq-tabbar"
      aria-label={isAr ? "تنقّل السائق" : "Navigation livreur"}
    >
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={"mq-tab" + (active ? " active" : "")}
          >
            <svg
              viewBox="0 0 24 24"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {"clock" in item && item.clock ? (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </>
              ) : "user" in item && item.user ? (
                <>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </>
              ) : (
                <path d={item.path} />
              )}
            </svg>
            {isAr ? LABELS_AR[item.label] : item.label}
          </Link>
        );
      })}
    </nav>
  );
}
