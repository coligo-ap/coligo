"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { SORA } from "@/components/shared/partner-ui";

/**
 * Onglets du HUB ARGENT : tout ce qui touche à l'argent regroupé en UNE
 * expérience (l'utilisateur bascule sans se perdre). Les onglets sont des
 * <Link> préfetchés : bascule instantanée (loading.tsx + router cache),
 * chaque volet garde son URL (deep-links et navs inchangés).
 *
 * `HubTabs` = générique ; `MoneyTabs` (livreur/chauffeur) et
 * `MerchantMoneyTabs` (commerçant) = presets par espace.
 */
export type HubTab = { href: string; label: string; match: readonly string[] };

export function HubTabs({ tabs }: { tabs: readonly HubTab[] }) {
  const pathname = usePathname();
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

/** Preset livreur/chauffeur : Gains · Courses · Coligo Pay. */
export function MoneyTabs({ base }: { base: "/driver" | "/chauffeur" }) {
  const isAr = useLocale() === "ar";
  return (
    <HubTabs
      tabs={[
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
      ]}
    />
  );
}

/** Preset COMMERÇANT : Finances · Stats · Coligo Pay (l'argent du commerce
 *  regroupé — verdict/versements/factures, chiffre d'affaires, portefeuille). */
export function MerchantMoneyTabs() {
  return (
    <HubTabs
      tabs={[
        {
          href: "/finances",
          label: "Finances",
          match: ["/finances"],
        },
        { href: "/stats", label: "Stats", match: ["/stats"] },
        {
          href: "/recharger",
          label: "Coligo Pay",
          match: ["/recharger"],
        },
      ]}
    />
  );
}
