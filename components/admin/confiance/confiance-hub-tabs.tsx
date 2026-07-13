"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Flag,
  IdCard,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/reports", label: "Signalements", icon: Flag },
  { href: "/admin/identite", label: "Identité", icon: IdCard },
  { href: "/admin/devices", label: "Appareils", icon: MonitorSmartphone },
  { href: "/admin/security", label: "Sécurité", icon: ShieldCheck },
  { href: "/admin/integrity", label: "Intégrité", icon: Activity },
] as const;

export function ConfianceHubTabs() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = pathname.startsWith(t.href);
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
