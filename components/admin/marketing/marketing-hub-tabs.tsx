"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, Gift, Megaphone, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/admin/marketing",
    label: "Bannières",
    icon: Megaphone,
    exact: true,
  },
  {
    href: "/admin/marketing/codes",
    label: "Codes promo",
    icon: Ticket,
  },
  {
    href: "/admin/marketing/bons",
    label: "Bons d'achat",
    icon: Gift,
  },
  {
    href: "/admin/marketing/notifications",
    label: "Notifications",
    icon: BellRing,
  },
] as const;

export function MarketingHubTabs() {
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
