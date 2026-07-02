"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { SORA } from "@/components/shared/partner-ui";

/**
 * Onglets du HUB ARGENT partagé livreur/chauffeur : Gains · Courses ·
 * Coligo Pay regroupés en UNE expérience (l'utilisateur bascule sans se
 * perdre ; le relevé reste une sous-page du volet Gains). Les onglets sont
 * des <Link> préfetchés : bascule instantanée (loading.tsx + router cache),
 * chaque volet garde son URL (deep-links et nav basse inchangés).
 */
export function MoneyTabs({ base }: { base: "/driver" | "/chauffeur" }) {
  const pathname = usePathname();
  const isAr = useLocale() === "ar";
  const tabs = [
    {
      href: `${base}/gains`,
      label: isAr ? "الأرباح" : "Gains",
      // Le relevé appartient au volet Gains.
      match: [`${base}/gains`, `${base}/releve`],
    },
    {
      href: `${base}/historique`,
      label: isAr ? "التوصيلات" : "Courses",
      match: [`${base}/historique`],
    },
    {
      href: `${base}/recharger`,
      label: "Coligo Pay",
      match: [`${base}/recharger`],
    },
  ];
  return (
    <div className="mb-4 flex gap-[3px] rounded-[14px] bg-[var(--d-soft)] p-1">
      {tabs.map((t) => {
        const on = t.match.some((p) => pathname.startsWith(p));
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch
            className="flex-1 rounded-[11px] p-2 text-center text-[12.5px] font-bold transition-colors"
            style={
              on
                ? {
                    fontFamily: SORA,
                    background: "var(--d-surface)",
                    color: "var(--d-ink)",
                    boxShadow: "0 4px 12px -6px rgba(0,0,0,.25)",
                  }
                : { color: "var(--d-muted)" }
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
