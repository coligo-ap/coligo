"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Navigation, Settings } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { detectAndStoreLocation } from "@/lib/customer/detect-location";
import { LocationPicker } from "@/components/customer/location-picker";
import {
  canOpenAppSettings,
  openAppSettings,
  openLocationSettings,
  readGeoPermission,
} from "@/lib/native";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

/**
 * Carte d'appel à la localisation, affichée en haut de la home TANT QUE la
 * position du client n'est PAS détectée. Bouton « Autoriser la localisation »
 * (déclenche la demande GPS native d'un seul tap) + repli « Choisir
 * manuellement » (sélecteur d'adresse). Disparaît dès qu'une position est
 * détectée (coords GPS ou zone choisie).
 *
 * En NATIF (app iOS/Android), quand l'OS ne réaffichera plus jamais le
 * dialogue (permission refusée) ou que le service de localisation est éteint,
 * redemander ne sert à rien : l'action principale devient « Ouvrir les
 * réglages » et mène DIRECTEMENT au bon écran système (style Uber). Au retour,
 * la reprise au premier plan relit la permission — et `LocationAutoDetect`
 * détecte la position tout de suite si elle est désormais accordée.
 */
export function LocationBanner() {
  const t = useTranslations("account");
  const loc = useCustomerLocation();
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [denied, setDenied] = useState(false);
  // "denied" = autorisation refusée → fiche de l'app ; "off" = service système
  // éteint → réglages de position. `null` = chemin normal (dialogue possible).
  const [needSettings, setNeedSettings] = useState<null | "denied" | "off">(
    null
  );

  // Natif : connaître l'impasse AVANT le premier tap, pour afficher d'emblée
  // le bon bouton (« Ouvrir les réglages ») — pas un tap dans le vide.
  useEffect(() => {
    if (!canOpenAppSettings()) return;
    let cancelled = false;
    const check = () =>
      void readGeoPermission().then((p) => {
        if (cancelled) return;
        setNeedSettings(p === "denied" || p === "off" ? p : null);
      });
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Retour des réglages : re-lire la permission (l'impasse a pu être levée —
  // le bouton redevient « Autoriser », ou la carte disparaît via l'auto-détect).
  useResumeResync(() => {
    if (!canOpenAppSettings()) return;
    void readGeoPermission().then((p) =>
      setNeedSettings(p === "denied" || p === "off" ? p : null)
    );
  });

  // `loc === null` → SSR / pas encore chargé : on ne flash rien.
  if (loc === null) return null;
  // Position DÉJÀ détectée (coords GPS OU zone choisie) → on n'affiche rien.
  if (loc.latitude != null || loc.wilaya_code) return null;

  async function allow() {
    // Impasse connue → le tap ouvre DIRECTEMENT le bon écran des réglages.
    if (needSettings) {
      const ok =
        needSettings === "off"
          ? await openLocationSettings()
          : await openAppSettings();
      // Binaire antérieur au plugin : impossible d'ouvrir → choix manuel.
      if (!ok) {
        setDenied(true);
        setOpen(true);
      }
      return;
    }
    setDetecting(true);
    setDenied(false);
    const ok = await detectAndStoreLocation({ highAccuracy: true });
    setDetecting(false);
    if (!ok) {
      // Échec : si le natif sait dire POURQUOI (refus / service éteint), on
      // bascule sur « Ouvrir les réglages » au lieu d'abandonner en manuel.
      if (canOpenAppSettings()) {
        const p = await readGeoPermission();
        if (p === "denied" || p === "off") {
          setNeedSettings(p);
          return;
        }
      }
      // Refus / indispo sans issue réglages → on bascule sur le choix manuel.
      setDenied(true);
      setOpen(true);
    }
    // Succès → le store émet l'event, la carte disparaît (loc.latitude posé).
  }

  return (
    <>
      <div className="border-primary-100 bg-primary-50 mb-4 flex items-center gap-3 rounded-lg border p-3.5">
        <span className="bg-primary-600 rounded-card grid size-11 shrink-0 place-items-center text-white">
          <Navigation className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-extrabold">
            {t("allowLocation")}
          </p>
          <p className="text-muted mt-0.5 text-xs font-medium">
            {needSettings === "off"
              ? t("locationOffSettings")
              : needSettings === "denied"
                ? t("locationDeniedSettings")
                : denied
                  ? t("locationDeniedManual")
                  : t("allowLocationSub")}
          </p>
        </div>
        <button
          type="button"
          onClick={allow}
          disabled={detecting}
          className="bg-primary-600 hover:bg-primary-700 rounded-control-lg inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-60"
        >
          {detecting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("detectingLocation")}
            </>
          ) : needSettings ? (
            <>
              <Settings className="size-3.5" />
              {t("openSettings")}
            </>
          ) : (
            <>
              <MapPin className="size-3.5" />
              {t("allowLocation")}
            </>
          )}
        </button>
      </div>

      {/* Repli manuel (sélecteur d'adresse complet : recherche + carte + GPS). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary-700 -mt-2 mb-4 block text-xs font-semibold underline"
      >
        {t("chooseManually")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="bg-surface flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:max-h-[90vh] sm:rounded-xl"
            style={{
              paddingBottom: "calc(0px + env(safe-area-inset-bottom))",
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
