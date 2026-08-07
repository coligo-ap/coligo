"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { BarChart3, Car, ChevronLeft, Home, User } from "lucide-react";
import { PartnerTabbar, type PartnerTab } from "@/components/shared/partner-ui";

/**
 * Bouton « Retour » standard de l'espace chauffeur : revient À L'ÉCRAN
 * PRÉCÉDENT (router.back) au lieu de forcer une destination — sinon, depuis le
 * Compte, on retombait sur l'accueil/connexion au lieu de revenir au Compte.
 */
export function DBack({ className }: { className?: string }) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={isAr ? "رجوع" : "Retour"}
      className={
        className ??
        "grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
      }
    >
      <ChevronLeft className="size-5 rtl:rotate-180" />
    </button>
  );
}

/**
 * Nav chauffeur (maquette) : Accueil · Drive · Gains · Coligo Pay · Compte.
 * Rendue par la primitive PARTAGÉE `PartnerTabbar` (même composant que
 * l'espace livreur) — prefetch complet conservé (routes dynamiques gate).
 */
// HUB ARGENT : Gains/Courses/Coligo Pay vivent dans UNE page à onglets
// (MoneyTabs) → la nav basse se simplifie, l'onglet Gains reste actif sur
// toutes les sous-routes du hub.
const TABS: readonly PartnerTab[] = [
  {
    href: "/chauffeur",
    label: "Accueil",
    labelAr: "الرئيسية",
    icon: Home,
    exact: true,
  },
  {
    href: "/chauffeur/demandes",
    label: "Drive",
    labelAr: "درايف",
    icon: Car,
    // Les sous-pages Inter-wilayas et Covoiturage restent sous l'onglet Drive.
    match: ["/chauffeur/interwilayas", "/chauffeur/covoiturage"],
  },
  {
    href: "/chauffeur/gains",
    label: "Gains",
    labelAr: "الأرباح",
    icon: BarChart3,
    match: ["/chauffeur/historique", "/chauffeur/recharger"],
  },
  { href: "/chauffeur/compte", label: "Compte", labelAr: "الحساب", icon: User },
];

export function DNav() {
  return (
    <PartnerTabbar items={TABS} height={66} ariaLabel="Navigation chauffeur" />
  );
}

export function PlanIcon({ plan }: { plan: "free" | "pro" | "premium" }) {
  const free = plan === "free";
  // Free : icône NEUTRE (pas de taux en dur — au lancement la commission est 0 %).
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-[11px] text-[15px] font-extrabold ${
        free
          ? "bg-[var(--d-soft)] text-[var(--d-ink)]"
          : "bg-[#E8B53C] text-[#3a2c00]"
      }`}
    >
      {free ? "🚗" : plan === "pro" ? "💼" : "👑"}
    </span>
  );
}

export const PLAN_LABEL: Record<string, string> = {
  free: "Gratuit",
  pro: "Pro",
  premium: "Premium",
};

/** Mêmes libellés de plan, en arabe (Pro/Premium restent des noms propres). */
export const PLAN_LABEL_AR: Record<string, string> = {
  free: "مجاني",
  pro: "Pro",
  premium: "Premium",
};

export function fmtPct(rate: number): string {
  return `${String(Math.round(rate * 1000) / 10).replace(".", ",")} %`;
}
