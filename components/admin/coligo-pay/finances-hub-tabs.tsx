"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, BadgeCheck, PiggyBank, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// Onglets du hub Coligo Pay & Finances. La fiche agent (/admin/agents/[id]) est
// sur un autre arbre de routes : elle n'affiche pas ces onglets.
const TABS = [
  {
    href: "/admin/coligo-pay",
    label: "Surveillance",
    icon: ShieldCheck,
    exact: true,
  },
  { href: "/admin/coligo-pay/agents", label: "Agents", icon: BadgeCheck },
  {
    href: "/admin/coligo-pay/recharges",
    label: "Recharges",
    icon: PiggyBank,
  },
  {
    href: "/admin/coligo-pay/versements",
    label: "Versements",
    icon: Banknote,
  },
] as const;

export function FinancesHubTabs() {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = isActive(t.href, "exact" in t ? t.exact : false);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary-50 text-primary-700"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
