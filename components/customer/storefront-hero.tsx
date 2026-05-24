"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, MapPin, ShoppingBag, Sparkles, User } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { LocationPicker } from "@/components/customer/location-picker";

// =============================================================================
// StorefrontHero — hero + header combinés sur la home (UNIQUEMENT /).
// =============================================================================
// Sur les autres pages, le CustomerHeader standard est rendu par le shell.
// Sur la home, on remplace ce header par ce hero violet qui absorbe ses
// fonctions (logo, localisation, cart, compte) et y ajoute une salutation
// chaleureuse. Pas de doublon, pas de coupure visuelle.
//
// Le hero N'EST PAS sticky : il défile avec le contenu. Le client utilise la
// bottom-nav pour revenir à l'accueil (pattern Yassir / Talabat).
// =============================================================================

type Props = {
  isAuth: boolean;
  firstName?: string | null;
};

export function StorefrontHero({ isAuth, firstName }: Props) {
  const loc = useCustomerLocation();
  const cart = useCart();
  const cartCount = totalUnits(cart);
  const [pickerOpen, setPickerOpen] = useState(false);

  const wilayaLabel = loc?.wilaya_code
    ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
      `Wilaya ${loc.wilaya_code}`)
    : "Choisir une zone";

  const greeting = firstName
    ? `Salut ${firstName} 👋`
    : "Qu'est-ce qu'on commande ?";

  return (
    <>
      <section className="from-primary-700 via-primary-600 to-primary-500 relative -mx-4 -mt-4 overflow-hidden rounded-b-[28px] bg-gradient-to-br px-4 pt-4 pb-6 text-white shadow-md lg:-mx-6 lg:-mt-8 lg:px-6 lg:pt-6 lg:pb-8">
        {/* Pattern décoratif léger (bulles violet plus clair en arrière-plan) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(60% 50% at 90% 10%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%), radial-gradient(45% 35% at 10% 100%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%)",
          }}
        />

        <div className="relative mx-auto max-w-[1400px]">
          {/* Ligne 1 : barre header — logo + location + compte + cart */}
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Coligo" className="shrink-0">
              {/* Pastille blanche avec C violet — contraste assuré sur le
                  dégradé violet du hero (le Logo standard a un fond violet
                  qui se fondrait dans le hero). */}
              <span className="text-primary-700 flex size-10 items-center justify-center rounded-xl bg-white text-lg font-bold shadow-sm">
                C
              </span>
            </Link>

            {/* Localisation cliquable — pilule blanche translucide */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="group inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-left backdrop-blur transition-colors hover:bg-white/25 lg:max-w-[260px]"
            >
              <MapPin className="size-3.5 shrink-0 text-white/90" />
              <span className="min-w-0 truncate text-sm font-semibold">
                {wilayaLabel}
                {loc?.commune && (
                  <span className="text-white/80"> · {loc.commune}</span>
                )}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-white/80" />
            </button>

            {/* Sur desktop : un peu d'espace + un lien "Devenir commerçant" */}
            <Link
              href="/login"
              className="hidden text-xs font-medium text-white/85 hover:text-white lg:inline"
            >
              Devenir commerçant
            </Link>

            {/* Cart — badge corail avec compteur si > 0 */}
            <Link
              href="/cart"
              aria-label="Panier"
              className="relative shrink-0 rounded-full p-2 transition-colors hover:bg-white/15"
            >
              <ShoppingBag className="size-5" />
              {cartCount > 0 && (
                <span className="bg-coral-500 absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* Compte / Se connecter */}
            {isAuth ? (
              <Link
                href="/compte"
                aria-label="Mon compte"
                className="shrink-0 rounded-full bg-white/15 p-1.5 transition-colors hover:bg-white/15"
              >
                <div className="text-primary-700 flex size-7 items-center justify-center rounded-full bg-white text-sm font-bold">
                  {(firstName ?? "C").charAt(0).toUpperCase()}
                </div>
              </Link>
            ) : (
              <Link
                href="/se-connecter"
                className="text-primary-700 inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/90"
              >
                <User className="size-3.5" />
                Se connecter
              </Link>
            )}
          </div>

          {/* Ligne 2 : salutation chaleureuse */}
          <div className="mt-5">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-white/80 uppercase">
              <Sparkles className="size-3.5" />
              Coligo · Click & Collect
            </p>
            <h1 className="font-display mt-1 text-2xl leading-tight font-bold lg:text-3xl">
              {greeting}
            </h1>
            <p className="mt-1 max-w-md text-sm text-white/85">
              Commande dans tes commerces de quartier, retire sans faire la
              queue.
            </p>
          </div>
        </div>
      </section>

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
