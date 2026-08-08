"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Car,
  ClipboardList,
  Heart,
  Home,
  MapPin,
  Menu,
  Coins,
  ShoppingCart,
  Store,
  User,
  Wallet,
  X,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

// =============================================================================
// Drawer de navigation CLIENT (web desktop). Sur desktop il n'y a pas de
// bottom-nav (celle-ci est `lg:hidden`) → ce tiroir donne accès à toutes les
// pages et services depuis le header. Trigger visible en `lg` uniquement
// (le mobile garde sa barre du bas). Navigation client-side (Link prefetché).
// =============================================================================

type NavItem = {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** clé de masquage super-admin (drive/pay) — alignée sur la bottom-nav. */
  hideKey?: string;
};

const PRIMARY: NavItem[] = [
  { href: "/", key: "home", icon: Home },
  { href: "/commandes", key: "orders", icon: ClipboardList },
  { href: "/drive", key: "drive", icon: Car, hideKey: "drive" },
  { href: "/coligo-pay", key: "pay", icon: Wallet, hideKey: "pay" },
  { href: "/compte", key: "account", icon: User },
];

const SERVICES: NavItem[] = [
  { href: "/favoris", key: "favorites", icon: Heart },
  { href: "/cashback", key: "cashback", icon: Coins },
  { href: "/adresses", key: "addresses", icon: MapPin },
  { href: "/cart", key: "cart", icon: ShoppingCart },
];

export function CustomerDrawer({ hiddenKeys = [] }: { hiddenKeys?: string[] }) {
  const t = useTranslations("nav");
  const tHeader = useTranslations("header");
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  // Ferme au changement de route (sécurité : la nav client garde le drawer monté).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Échap pour fermer + verrouille le scroll de fond quand ouvert.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const Row = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-primary-50 text-primary-700"
            : "text-foreground hover:bg-surface-2"
        )}
      >
        <Icon className={cn("size-5", active && "text-primary-600")} />
        <span>{t(item.key)}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Trigger — desktop uniquement */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hover:bg-surface-2 border-border rounded-control hidden size-10 shrink-0 place-items-center border lg:grid"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 hidden lg:block"
          role="dialog"
          aria-modal="true"
          aria-label={t("menu")}
        >
          {/* Voile */}
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          {/* Panneau (gauche en LTR, droite en RTL via start) */}
          <aside className="bg-surface absolute inset-y-0 start-0 flex w-[300px] max-w-[86vw] flex-col border-e shadow-xl">
            <div className="border-border flex items-center justify-between border-b px-4 py-3.5">
              <Link href="/" onClick={() => setOpen(false)}>
                <Logo variant="amber" size="sm" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="hover:bg-surface-2 grid size-9 place-items-center rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <p className="text-muted text-caption px-3 pb-1.5 font-bold tracking-wide uppercase">
                {t("navigation")}
              </p>
              <div className="space-y-0.5">
                {PRIMARY.filter(
                  (i) => !i.hideKey || !hiddenKeys.includes(i.hideKey)
                ).map(Row)}
              </div>

              <p className="text-muted text-caption mt-5 px-3 pb-1.5 font-bold tracking-wide uppercase">
                {t("services")}
              </p>
              <div className="space-y-0.5">{SERVICES.map(Row)}</div>
            </nav>

            <div className="border-border border-t p-3">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="text-muted hover:bg-surface-2 hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium"
              >
                <Store className="size-5" />
                <span>{tHeader("becomeMerchant")}</span>
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
