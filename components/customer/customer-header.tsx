"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, MapPin, ShoppingCart, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
import { APP_THEMES, type AppThemeKey } from "@/lib/config/app-themes";
import { cn } from "@/lib/utils";
import {
  LOCATION_PICKER_OPEN_EVENT,
  useCustomerLocation,
} from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { LocationPicker } from "@/components/customer/location-picker";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
import { NotificationBell } from "@/components/shared/notification-bell";
import { CustomerDrawer } from "@/components/customer/customer-drawer";

type Props = {
  isAuth: boolean;
  customerName?: string | null;
  /** Onglets masqués par le super-admin (drive/pay) — repris dans le drawer. */
  hiddenKeys?: string[];
  /**
   * Thème « occasion » de l'accueil (mig 0415/0416, activé par le super-admin).
   * Appliqué UNIQUEMENT sur la route « / » : le header se peint en g1 uni et
   * forme un seul bloc avec le héro dégradé de la home. Ailleurs : blanc.
   */
  homeTheme?: { theme: AppThemeKey } | null;
};

export function CustomerHeader({
  isAuth,
  customerName,
  hiddenKeys = [],
  homeTheme = null,
}: Props) {
  const t = useTranslations("header");
  const pathname = usePathname();
  // Coque PERSISTANTE : le même header sert toutes les routes client — le
  // thème ne s'applique que sur l'accueil.
  const themed = !!homeTheme && pathname === "/";
  const tp = themed ? APP_THEMES[homeTheme.theme] : null;
  const loc = useCustomerLocation();
  const cart = useCart();
  const cartCount = totalUnits(cart);
  const [pickerOpen, setPickerOpen] = useState(false);

  // D'autres écrans (état vide de la home…) ouvrent LA MÊME feuille de
  // position que le header via cet événement — une seule UX de changement
  // de zone dans toute l'app.
  useEffect(() => {
    const onOpen = () => setPickerOpen(true);
    window.addEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
  }, []);

  const wilayaLabel = loc?.wilaya_code
    ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
      `Wilaya ${loc.wilaya_code}`)
    : t("chooseZone");

  // Si le client a confirmé une POSITION EXACTE (GPS ou repère carte), on
  // affiche son adresse précise telle quelle → il voit que sa vraie position
  // est prise en compte. Sinon on retombe sur « wilaya · commune ».
  const exactAddress = loc?.address?.trim() ? loc.address.trim() : null;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 pt-[env(safe-area-inset-top)]",
          themed ? "text-white" : "border-border border-b bg-white"
        )}
        style={tp ? { backgroundColor: tp.g1 } : undefined}
      >
        {/* Desktop */}
        <div className="mx-auto hidden h-16 max-w-[1400px] items-center gap-4 px-6 lg:flex">
          {/* Drawer de navigation (desktop : remplace la bottom-nav absente). */}
          <CustomerDrawer hiddenKeys={hiddenKeys} />

          <Link href="/" className="shrink-0">
            <Logo variant="amber" size="md" />
          </Link>

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={cn(
              "inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm",
              themed
                ? "border-white/25 hover:bg-white/10"
                : "hover:bg-surface-2 border-border"
            )}
          >
            <MapPin
              className={cn(
                "size-4",
                themed ? "text-white" : "text-primary-600"
              )}
            />
            <span className="max-w-[220px] truncate font-medium">
              {exactAddress ?? (
                <>
                  {wilayaLabel}
                  {loc?.commune && (
                    <span className={themed ? "text-white/70" : "text-muted"}>
                      {" "}
                      · {loc.commune}
                    </span>
                  )}
                </>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5",
                themed ? "text-white/70" : "text-muted"
              )}
            />
          </button>

          {/* Espace flexible — la barre de recherche est désormais sur la
              home (sticky sous le header). */}
          <div className="flex-1" />

          <Link
            href="/login"
            className={cn(
              "text-sm font-medium",
              themed
                ? "text-white/85 hover:text-white"
                : "text-muted hover:text-foreground"
            )}
          >
            {t("becomeMerchant")}
          </Link>

          {/* Sur fond thémé, déclencheurs en blanc (prop explicite — les
              MENUS en portal restent normaux). */}
          <LanguageSwitcher onColor={themed} />
          <ThemeSwitcher onColor={themed} />

          {isAuth && (
            <NotificationBell
              source={{ table: "user_notifications", audience: "customer" }}
              className={cn(
                "rounded-full p-2",
                themed ? "text-white hover:bg-white/10" : "hover:bg-surface-2"
              )}
              iconClassName="size-5"
            />
          )}

          <Link
            href="/cart"
            className={cn(
              "relative rounded-full p-2",
              themed ? "hover:bg-white/10" : "hover:bg-surface-2"
            )}
            aria-label={t("cart")}
          >
            <ShoppingCart className="size-5" />
            {cartCount > 0 && (
              <span className="bg-primary-600 absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>

          {isAuth ? (
            <Link
              href="/compte"
              className="hover:bg-surface-2 inline-flex items-center gap-2 rounded-full p-1 text-sm"
            >
              <div className="bg-primary-100 text-primary-700 flex size-9 items-center justify-center rounded-full text-sm font-semibold">
                {(customerName ?? "C").charAt(0).toUpperCase()}
              </div>
            </Link>
          ) : (
            <Link
              href="/se-connecter"
              className={cn(
                "inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium",
                themed
                  ? "bg-white text-neutral-900 hover:bg-white/90"
                  : "bg-primary-600 hover:bg-primary-700 text-white"
              )}
            >
              <User className="size-4" />
              {t("signIn")}
            </Link>
          )}
        </div>

        {/* Mobile */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 text-start"
            >
              <MapPin
                className={cn(
                  "size-4 shrink-0",
                  themed ? "text-white" : "text-primary-600"
                )}
              />
              <span className="min-w-0 truncate text-sm font-medium">
                {exactAddress ?? (
                  <>
                    {wilayaLabel}
                    {loc?.commune && (
                      <span className={themed ? "text-white/70" : "text-muted"}>
                        {" "}
                        · {loc.commune}
                      </span>
                    )}
                  </>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0",
                  themed ? "text-white/70" : "text-muted"
                )}
              />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <LanguageSwitcher compact onColor={themed} />
              <ThemeSwitcher onColor={themed} />
              {isAuth && (
                <NotificationBell
                  source={{ table: "user_notifications", audience: "customer" }}
                  className={cn(
                    "grid size-[38px] place-items-center rounded-full",
                    themed
                      ? "bg-white/15 text-white"
                      : "bg-surface-2 text-foreground"
                  )}
                />
              )}
              {isAuth ? (
                <Link
                  href="/compte"
                  aria-label={t("myAccount")}
                  className={cn(
                    "grid size-[38px] place-items-center rounded-full text-sm font-bold",
                    themed
                      ? "bg-white/15 text-white"
                      : "bg-surface-2 text-primary-700"
                  )}
                >
                  {(customerName ?? "C").charAt(0).toUpperCase()}
                </Link>
              ) : (
                <Link
                  href="/se-connecter"
                  aria-label={t("signIn")}
                  className={cn(
                    "grid size-[38px] place-items-center rounded-full",
                    themed
                      ? "bg-white/15 text-white"
                      : "bg-surface-2 text-foreground"
                  )}
                >
                  <User className="size-[18px]" />
                </Link>
              )}
              <Link
                href="/cart"
                aria-label={t("cart")}
                className={cn(
                  "relative grid size-[38px] place-items-center rounded-full",
                  themed
                    ? "bg-white/15 text-white"
                    : "bg-surface-2 text-foreground"
                )}
              >
                <ShoppingCart className="size-[18px]" />
                {cartCount > 0 && (
                  <span className="bg-success-600 absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-white px-1 text-[9px] font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
          {/* Search bar mobile : retirée du header — désormais sur la home
              (sticky sous le header). */}
        </div>
      </header>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div
            className="bg-surface flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[90vh] sm:rounded-[20px]"
            style={{
              paddingBottom: "calc(0px + env(safe-area-inset-bottom))",
            }}
          >
            <div className="overflow-y-auto overscroll-contain px-5 pt-5 pb-5">
              <LocationPicker
                initial={loc}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
