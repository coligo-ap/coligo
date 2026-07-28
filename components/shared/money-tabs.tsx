"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { SORA } from "@/components/shared/partner-ui";
import { ThemeDecor } from "@/components/shared/theme-decor";

const VIOLET = "#6C2BD9";

/**
 * Onglets du HUB ARGENT : tout ce qui touche à l'argent regroupé en UNE
 * expérience (l'utilisateur bascule sans se perdre). Les onglets sont des
 * <Link> préfetchés : bascule instantanée (loading.tsx + router cache),
 * chaque volet garde son URL (deep-links et navs inchangés).
 *
 * `heroTitle` (opt-in) : mode HÉRO thémé — bandeau au dégradé du thème
 * « occasion » (vars sur <html>, mig 0415/0416) + décor du modèle, titre
 * blanc, et la barre d'onglets en PILULE FLOTTANTE qui chevauche le dégradé
 * (même langage que l'accueil Drive / marketplace). Le parent doit avoir
 * `px-5` (le bandeau s'étend en pleine largeur via -mx-5) et NE PAS mettre
 * `pt-safe` (le héro gère la safe-area lui-même).
 *
 * `HubTabs` = générique ; `MoneyTabs` (livreur/chauffeur) et
 * `MerchantMoneyTabs` (commerçant) = presets par espace.
 */
export type HubTab = { href: string; label: string; match: readonly string[] };

export function HubTabs({
  tabs,
  heroTitle,
}: {
  tabs: readonly HubTab[];
  heroTitle?: string;
}) {
  const pathname = usePathname();
  const hero = !!heroTitle;

  const bar = (
    <div
      className={
        hero
          ? "flex gap-[3px] rounded-[14px] bg-[var(--d-surface)] p-1.5 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.45)]"
          : "mb-4 flex gap-[3px] rounded-[14px] bg-[var(--d-soft)] p-1"
      }
    >
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
                ? hero
                  ? {
                      fontFamily: SORA,
                      background: "var(--d-accent)",
                      color: VIOLET,
                    }
                  : {
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

  if (!hero) return bar;
  return (
    <div className="-mx-5 mb-4">
      <div
        className="relative overflow-hidden rounded-b-[28px] px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-12 text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <h1 className="drive-sora relative z-10 text-[21px] font-extrabold tracking-[-0.5px] drop-shadow-sm">
          {heroTitle}
        </h1>
      </div>
      <div className="relative z-10 -mt-7 px-5">{bar}</div>
    </div>
  );
}

/** Preset livreur/chauffeur : Gains · Courses · Coligo Pay. */
export function MoneyTabs({
  base,
  heroTitle,
}: {
  base: "/driver" | "/chauffeur";
  heroTitle?: string;
}) {
  const isAr = useLocale() === "ar";
  return (
    <HubTabs
      heroTitle={heroTitle}
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
