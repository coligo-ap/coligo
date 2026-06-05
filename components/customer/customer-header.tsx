"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, MapPin, ShoppingCart, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { LocationPicker } from "@/components/customer/location-picker";

type Props = {
  isAuth: boolean;
  customerName?: string | null;
};

export function CustomerHeader({ isAuth, customerName }: Props) {
  const loc = useCustomerLocation();
  const cart = useCart();
  const cartCount = totalUnits(cart);
  const [pickerOpen, setPickerOpen] = useState(false);

  const wilayaLabel = loc?.wilaya_code
    ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
      `Wilaya ${loc.wilaya_code}`)
    : "Choisir une zone";

  return (
    <>
      <header className="border-border sticky top-0 z-30 border-b bg-white pt-[env(safe-area-inset-top)]">
        {/* Desktop */}
        <div className="mx-auto hidden h-16 max-w-[1400px] items-center gap-6 px-6 lg:flex">
          <Link href="/" className="shrink-0">
            <Logo variant="amber" size="md" />
          </Link>

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="hover:bg-surface-2 border-border inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm"
          >
            <MapPin className="text-primary-600 size-4" />
            <span className="max-w-[160px] truncate font-medium">
              {wilayaLabel}
              {loc?.commune && (
                <span className="text-muted"> · {loc.commune}</span>
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
            Devenir commerçant
          </Link>

          <Link
            href="/cart"
            className="hover:bg-surface-2 relative rounded-full p-2"
            aria-label="Panier"
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
              Se connecter
            </Link>
          )}
        </div>

        {/* Mobile */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <MapPin className="text-primary-600 size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium">
                {wilayaLabel}
                {loc?.commune && (
                  <span className="text-muted"> · {loc.commune}</span>
                )}
              </span>
              <ChevronDown className="text-muted size-3.5 shrink-0" />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              {isAuth ? (
                <Link
                  href="/compte"
                  aria-label="Mon compte"
                  className="bg-surface-2 text-primary-700 grid size-[38px] place-items-center rounded-full text-sm font-bold"
                >
                  {(customerName ?? "C").charAt(0).toUpperCase()}
                </Link>
              ) : (
                <Link
                  href="/se-connecter"
                  aria-label="Se connecter"
                  className="bg-surface-2 text-foreground grid size-[38px] place-items-center rounded-full"
                >
                  <User className="size-[18px]" />
                </Link>
              )}
              <Link
                href="/cart"
                aria-label="Panier"
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
            className="bg-surface flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] shadow-xl sm:max-h-[90vh] sm:rounded-[20px]"
            style={{
              paddingBottom: "max(0px, env(safe-area-inset-bottom))",
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
