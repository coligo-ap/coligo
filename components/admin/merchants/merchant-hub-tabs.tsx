"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  ClipboardCheck,
  FileSignature,
  Percent,
  Receipt,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Onglets du hub Commerçants. Chaque onglet = une sous-route réelle (deep-link
// & rafraîchissement). Le domaine reste actif dans la sidebar (startsWith).
const TABS = [
  { href: "/admin/merchants", label: "Comptes", icon: Store, exact: true },
  {
    href: "/admin/merchants/inscriptions",
    label: "Inscriptions",
    icon: ClipboardCheck,
    badge: true,
  },
  { href: "/admin/merchants/commandes", label: "Commandes", icon: Receipt },
  { href: "/admin/merchants/finances", label: "Versements", icon: Banknote },
  { href: "/admin/merchants/taux", label: "Taux & paiement", icon: Percent },
  {
    href: "/admin/merchants/contrats",
    label: "Contrats",
    icon: FileSignature,
  },
] as const;

export function MerchantHubTabs({
  pendingCount = 0,
}: {
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = isActive(t.href, "exact" in t ? t.exact : false);
        const count = "badge" in t && t.badge ? pendingCount : 0;
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
            {count > 0 && (
              <span className="bg-warning-500 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
