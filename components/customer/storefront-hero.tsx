"use client";

import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { LocationPicker } from "@/components/customer/location-picker";

// =============================================================================
// StorefrontHero — bloc dégradé violet en haut de la home (mobile + tablet).
// =============================================================================
// Le hero affiche la localisation, un titre chaleureux, et accueille la search
// bar (MarketplaceSearchBar) en overlay sur le dégradé. La search est rendue
// par le parent (positionnée sticky sous le hero pour rester accessible au
// scroll).
//
// Sur desktop (> lg), le hero peut être masqué au profit d'une top navbar plus
// dense (voir layout). Pour MVP : on garde le hero visible partout, c'est
// chaleureux + cohérent.
// =============================================================================

type Props = {
  /** Prénom du client connecté pour le bonjour personnalisé (optionnel). */
  firstName?: string | null;
};

export function StorefrontHero({ firstName }: Props) {
  const loc = useCustomerLocation();
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
      <section
        // Dégradé du primaire (#5C5CE0) vers un violet plus clair, coins
        // inférieurs arrondis pour effet "sheet" qui remonte.
        className="from-primary-700 via-primary-600 to-primary-500 -mx-4 -mt-4 mb-4 rounded-b-[28px] bg-gradient-to-br px-4 pt-4 pb-8 text-white shadow-md lg:-mx-6 lg:-mt-8 lg:px-6 lg:pt-8 lg:pb-10"
      >
        {/* Ligne du haut : localisation (cliquable) + label "RETRAIT À" */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="group inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-left backdrop-blur transition-colors hover:bg-white/25"
        >
          <MapPin className="size-3.5 text-white/90" />
          <span className="text-[10px] font-semibold tracking-wider text-white/75 uppercase">
            Retrait à
          </span>
          <span className="max-w-[160px] truncate text-sm font-semibold">
            {wilayaLabel}
            {loc?.commune && (
              <span className="text-white/80"> · {loc.commune}</span>
            )}
          </span>
          <ChevronDown className="size-3.5 text-white/80" />
        </button>

        {/* Titre chaleureux */}
        <h1 className="font-display mt-3 text-2xl leading-tight font-bold lg:text-3xl">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-white/85">
          Tes commerces de quartier, en un clic.
        </p>
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
