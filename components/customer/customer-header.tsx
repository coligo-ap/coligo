"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, MapPin, ShoppingCart, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
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
};

export function CustomerHeader({
  isAuth,
  customerName,
  hiddenKeys = [],
}: Props) {
  const t = useTranslations("header");
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
      <header className="border-border sticky top-0 z-30 border-b bg-white pt-[env(safe-area-inset-top)]">
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
            className="hover:bg-surface-2 border-border inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm"
          >
            <MapPin className="text-primary-600 size-4" />
            <span className="max-w-[220px] truncate font-medium">
              {exactAddress ?? (
                <>
                  {wilayaLabel}
                  {loc?.commune && (
                    <span className="text-muted"> · {loc.commune}</span>
                  )}
                </>
              )}
            </span>
            <ChevronDown className="text-muted size-3.5" />
          </button>

          {/* Espace flexible — la barre de recherche est désormais sur la
              home (sticky sous le header). */}
          <div className="flex-1" />

          <Link
            href="/login"
            className="text-muted hover:text-foreground text-sm font-medium"
          >
            {t("becomeMerchant")}
          </Link>

          <LanguageSwitcher />
          <ThemeSwitcher />

          {isAuth && (
            <NotificationBell
              source={{ table: "user_notifications", audience: "customer" }}
              className="hover:bg-surface-2 rounded-full p-2"
              iconClassName="size-5"
            />
          )}

          <Link
            href="/cart"
            className="hover:bg-surface-2 relative rounded-full p-2"
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
              className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium text-white"
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
              <MapPin className="text-primary-600 size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium">
                {exactAddress ?? (
                  <>
                    {wilayaLabel}
                    {loc?.commune && (
                      <span className="text-muted"> · {loc.commune}</span>
                    )}
                  </>
                )}
              </span>
              <ChevronDown className="text-muted size-3.5 shrink-0" />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <LanguageSwitcher compact />
              <ThemeSwitcher />
              {isAuth && (
                <NotificationBell
                  source={{ table: "user_notifications", audience: "customer" }}
                  className="bg-surface-2 text-foreground grid size-[38px] place-items-center rounded-full"
                />
              )}
              {isAuth ? (
                <Link
                  href="/compte"
                  aria-label={t("myAccount")}
                  className="bg-surface-2 text-primary-700 grid size-[38px] place-items-center rounded-full text-sm font-bold"
                >
                  {(customerName ?? "C").charAt(0).toUpperCase()}
                </Link>
              ) : (
                <Link
                  href="/se-connecter"
                  aria-label={t("signIn")}
                  className="bg-surface-2 text-foreground grid size-[38px] place-items-center rounded-full"
                >
                  <User className="size-[18px]" />
                </Link>
              )}
              <Link
                href="/cart"
                aria-label={t("cart")}
                className="bg-surface-2 text-foreground relative grid size-[38px] place-items-center rounded-full"
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
