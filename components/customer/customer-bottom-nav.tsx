"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, ShoppingCart, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/cart", label: "Panier", icon: ShoppingCart },
  { href: "/commandes", label: "Commandes", icon: ClipboardList },
  { href: "/compte", label: "Compte", icon: User },
] as const;

export function CustomerBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="border-border fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-white pb-[max(env(safe-area-inset-bottom),0px)] lg:hidden"
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
            <span className="font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
