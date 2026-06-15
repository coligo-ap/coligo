"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { BarChart3, Car, Home, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIOLET } from "@/components/customer/drive/drive-modals";

/** Nav chauffeur (maquette) : Accueil · Drive · Gains · Compte. */
const TABS = [
  { href: "/chauffeur", label: "Accueil", ar: "الرئيسية", icon: Home },
  { href: "/chauffeur/demandes", label: "Drive", ar: "درايف", icon: Car },
  { href: "/chauffeur/gains", label: "Gains", ar: "الأرباح", icon: BarChart3 },
  { href: "/chauffeur/compte", label: "Compte", ar: "الحساب", icon: User },
] as const;

export function DNav() {
  const pathname = usePathname();
  const isAr = useLocale() === "ar";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[66px] grid-cols-4 border-t border-[var(--d-line)] bg-[var(--d-surface)] pb-[max(env(safe-area-inset-bottom),9px)]">
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
            className="flex flex-col items-center justify-center gap-[3px] text-[9.5px] font-semibold"
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
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#E8B53C] text-[13px] font-extrabold text-[#3a2c00]">
      {plan === "free" ? "8%" : plan === "pro" ? "💼" : "👑"}
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

export const cls = cn;
