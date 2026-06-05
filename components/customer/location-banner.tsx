"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { LocationPicker } from "@/components/customer/location-picker";

/**
 * Bandeau jaune affiché en haut de la home si AUCUNE localisation n'a été
 * choisie. Cliqué → ouvre le sélecteur. Disparait dès qu'une zone est définie.
 */
export function LocationBanner() {
  const t = useTranslations("account");
  const loc = useCustomerLocation();
  const [open, setOpen] = useState(false);

  // `loc === null` → SSR / pas encore chargé : on ne flash rien.
  if (loc === null) return null;
  if (loc.wilaya_code) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-warning-100 bg-warning-50 text-warning-700 hover:bg-warning-100/70 mb-4 flex w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-left text-sm transition-colors"
      >
        <MapPin className="text-warning-600 size-4 shrink-0" />
        <span className="flex-1">{t("setZonePrompt")}</span>
        <span className="text-warning-700 text-xs font-semibold">
          {t("choose")}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="bg-surface flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] shadow-xl sm:max-h-[90vh] sm:rounded-[20px]"
            style={{
              paddingBottom: "max(0px, env(safe-area-inset-bottom))",
            }}
          >
            <div className="overflow-y-auto overscroll-contain px-5 pt-5 pb-5">
              <LocationPicker initial={loc} onClose={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
