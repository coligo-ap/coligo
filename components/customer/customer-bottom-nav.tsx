"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, ClipboardList, Home, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

// Nav Coligo (PROMPT Drive §1) : Accueil · Commandes · Drive · Pay · Compte.
const ITEMS = [
  { href: "/", key: "home", icon: Home },
  { href: "/commandes", key: "orders", icon: ClipboardList },
  { href: "/drive", key: "drive", icon: Car },
  { href: "/coligo-pay", key: "pay", icon: Wallet },
  { href: "/compte", key: "account", icon: User },
] as const;

export function CustomerBottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      aria-label="Navigation principale"
      className="border-border fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white pb-[max(env(safe-area-inset-bottom),0px)] lg:hidden"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] transition-colors",
              active ? "text-primary-700" : "text-muted hover:text-foreground"
            )}
          >
            <Icon className={cn("size-5", active && "fill-primary-100")} />
            <span className="font-medium">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
