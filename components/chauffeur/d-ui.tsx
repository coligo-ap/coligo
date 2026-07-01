"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { BarChart3, Car, ChevronLeft, Home, User, Wallet } from "lucide-react";
import { VIOLET } from "@/components/customer/drive/drive-modals";

/**
 * Bouton « Retour » standard de l'espace chauffeur : revient À L'ÉCRAN
 * PRÉCÉDENT (router.back) au lieu de forcer une destination — sinon, depuis le
 * Compte, on retombait sur l'accueil/connexion au lieu de revenir au Compte.
 */
export function DBack({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Retour"
      className={
        className ??
        "grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
      }
    >
      <ChevronLeft className="size-5" />
    </button>
  );
}

/** Nav chauffeur (maquette) : Accueil · Drive · Gains · Coligo Pay · Compte. */
const TABS = [
  { href: "/chauffeur", label: "Accueil", ar: "الرئيسية", icon: Home },
  { href: "/chauffeur/demandes", label: "Drive", ar: "درايف", icon: Car },
  { href: "/chauffeur/gains", label: "Gains", ar: "الأرباح", icon: BarChart3 },
  {
    href: "/chauffeur/recharger",
    label: "Coligo Pay",
    ar: "كوليغو باي",
    icon: Wallet,
  },
  { href: "/chauffeur/compte", label: "Compte", ar: "الحساب", icon: User },
] as const;

export function DNav() {
  const pathname = usePathname();
  const isAr = useLocale() === "ar";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[66px] grid-cols-5 border-t border-[var(--d-line)] bg-[var(--d-surface)] pb-[max(env(safe-area-inset-bottom),9px)]">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active =
          tab.href === "/chauffeur"
            ? pathname === "/chauffeur"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            // prefetch complet : les routes chauffeur sont dynamiques (gate dans
            // la coque) ; sans ce flag, `<Link>` ne préfetcherait que la coque,
            // pas le contenu → chaque tap attendrait un aller-retour serveur
            // (serveur US, latence depuis l'Algérie). Avec prefetch={true} le
            // RSC de l'onglet est mis en cache à l'avance → bascule instantanée.
            prefetch
            className="flex flex-col items-center justify-center gap-[3px] text-[9.5px] font-semibold whitespace-nowrap"
            style={{ color: active ? VIOLET : "var(--d-muted)" }}
          >
            <Icon className="size-[21px]" />
            {isAr ? tab.ar : tab.label}
          </Link>
        );
      })}
    </nav>
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

export function fmtPct(rate: number): string {
  return `${String(Math.round(rate * 1000) / 10).replace(".", ",")} %`;
}
