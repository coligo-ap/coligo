"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, MapPin, Search, ShoppingBag, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { LocationPicker } from "@/components/customer/location-picker";

type Props = {
  isAuth: boolean;
  customerName?: string | null;
};

export function CustomerHeader({ isAuth, customerName }: Props) {
  const loc = useCustomerLocation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const wilayaLabel = loc?.wilaya_code
    ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
      `Wilaya ${loc.wilaya_code}`)
    : "Choisir une zone";

  return (
    <>
      <header className="border-border sticky top-0 z-30 border-b bg-white">
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

          <Link
            href="/search"
            className="border-border bg-surface-2 hover:border-primary-400 flex flex-1 items-center gap-2 rounded-[12px] border px-4 py-2 text-sm transition-colors"
          >
            <Search className="text-muted size-4" />
            <span className="text-muted">Rechercher un commerce…</span>
          </Link>

          <Link
            href="/login"
            className="text-muted hover:text-foreground text-sm font-medium"
          >
            Devenir commerçant
          </Link>

          <Link
            href="/cart"
            className="hover:bg-surface-2 rounded-full p-2"
            aria-label="Panier"
          >
            <ShoppingBag className="size-5" />
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
            {isAuth ? (
              <Link
                href="/compte"
                className="bg-primary-100 text-primary-700 flex size-9 items-center justify-center rounded-full text-sm font-semibold"
              >
                {(customerName ?? "C").charAt(0).toUpperCase()}
              </Link>
            ) : (
              <Link
                href="/se-connecter"
                className="text-primary-700 inline-flex items-center gap-1 rounded-[10px] px-2 py-1 text-sm font-medium"
              >
                <User className="size-4" />
                Compte
              </Link>
            )}
          </div>
          {/* Search bar sticky mobile */}
          <Link
            href="/search"
            className="border-border bg-surface-2 hover:border-primary-400 mx-4 mb-3 flex items-center gap-2 rounded-[12px] border px-3 py-2.5 text-sm"
          >
            <Search className="text-muted size-4" />
            <span className="text-muted">Rechercher un commerce…</span>
          </Link>
        </div>
      </header>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div className="bg-surface w-full max-w-md rounded-t-[20px] p-5 shadow-xl sm:rounded-[20px]">
            <LocationPicker
              initial={loc}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
