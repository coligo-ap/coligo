"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, MapPin, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  writeStoredLocation,
  type CustomerLocation,
} from "@/lib/customer/location-store";
import {
  reverseGeocode,
  updateCustomerLocation,
} from "@/app/(customer)/actions";
// Reverse géocodage PRÉCIS (zoom 18 : rue/quartier) pour le libellé exact
// affiché dans le header — distinct du reverseGeocode serveur (zoom 12 = zone).
import { reverseGeocode as reverseGeocodeAddress } from "@/lib/geo/geocode";

type Props = {
  /** Affiche un bouton "Annuler" / "Fermer" en haut à droite. */
  onClose?: () => void;
  /** Localisation actuelle pour préselectionner les champs. */
  initial: CustomerLocation | null;
};

type Detected = {
  wilaya_code: string | null;
  wilaya_name: string | null;
  commune: string | null;
  display: string;
};

export function LocationPicker({ onClose, initial }: Props) {
  const t = useTranslations("account");
  // Placeholder de la recherche d'adresse sur carte (clé partagée checkout).
  const tCheckout = useTranslations("checkout");
  const [wilaya, setWilaya] = useState(initial?.wilaya_code ?? "");
  const [commune, setCommune] = useState(initial?.commune ?? "");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [detected, setDetected] = useState<Detected | null>(null);
  // Coordonnées ajustées via la carte (après GPS ou clic carte).
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial?.latitude != null && initial?.longitude != null
      ? { lat: initial.latitude, lng: initial.longitude }
      : null
  );
  // Cible de recentrage IMPÉRATIF de la carte (posée par le bouton « ma
  // position »). Identité séparée de `coords` (alimenté par les déplacements de
  // carte) pour éviter toute boucle recentrage ↔ moveend.
  const [flyTarget, setFlyTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const geo = useGeolocation();

  const communes = useMemo(() => getCommunes(wilaya), [wilaya]);
  useEffect(() => {
    // Si on change de wilaya, on reset la commune si elle n'est plus listée.
    if (commune && !communes.includes(commune)) setCommune("");
  }, [wilaya, commune, communes]);

  async function save(loc: Partial<CustomerLocation>) {
    setSaving(true);
    try {
      writeStoredLocation(loc);
      await updateCustomerLocation({
        wilaya_code: loc.wilaya_code ?? null,
        commune: loc.commune ?? null,
        latitude: loc.latitude ?? null,
        longitude: loc.longitude ?? null,
      });
      toast.success(t("locationSaved"));
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  async function useGps() {
    setDetected(null);
    const gpsCoords = await geo.requestOnce();
    if (!gpsCoords) {
      // Échec NON bloquant : la carte reste là pour choisir à la main.
      toast.error(
        geo.error?.kind === "denied" ? t("permissionDenied") : t("geolocFailed")
      );
      return;
    }
    setCoords({ lat: gpsCoords.latitude, lng: gpsCoords.longitude });
    setFlyTarget({
      lat: gpsCoords.latitude,
      lng: gpsCoords.longitude,
      zoom: 17,
    });

    // Reverse-geocoding pour identifier wilaya + commune à partir des GPS
    // (pré-remplit les selects, le user pourra ajuster avant de valider).
    setResolving(true);
    try {
      const res = await reverseGeocode({
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
      });
      if (res.ok) {
        if (res.wilaya_code) setWilaya(res.wilaya_code);
        if (res.commune) setCommune(res.commune);
        setDetected({
          wilaya_code: res.wilaya_code ?? null,
          wilaya_name: res.wilaya_name ?? null,
          commune: res.commune ?? null,
          display:
            res.display ??
            [res.commune, res.wilaya_name].filter(Boolean).join(" · "),
        });
      }
    } finally {
      setResolving(false);
    }
    // NB : on N'ENREGISTRE PAS automatiquement. Le user voit sa position sur
    // la carte et clique "Confirmer ma position" pour valider/ajuster.
  }

  async function confirmFromMap() {
    if (!coords) {
      toast.error(t("positionNotSet"));
      return;
    }
    // Si aucune wilaya n'est encore choisie (point posé directement sur la
    // carte), on reverse-géocode le point pour déduire wilaya + commune → la
    // marketplace peut filtrer par zone. Échec silencieux (on garde les coords).
    let w = wilaya;
    let c = commune;
    if (!w) {
      setResolving(true);
      try {
        const res = await reverseGeocode({
          latitude: coords.lat,
          longitude: coords.lng,
        });
        if (res.ok) {
          w = res.wilaya_code ?? w;
          c = res.commune ?? c;
        }
      } catch {
        /* reverse-geocode indispo : on enregistre quand même les coordonnées */
      } finally {
        setResolving(false);
      }
    }
    // Adresse EXACTE lisible du point confirmé → affichée dans le header pour
    // que le client soit sûr que sa position précise est prise en compte.
    // Échec silencieux : on enregistre quand même (le header retombe alors sur
    // commune · wilaya).
    let address: string | null = null;
    try {
      address = await reverseGeocodeAddress(coords.lat, coords.lng);
    } catch {
      /* géocodage indispo */
    }
    await save({
      latitude: coords.lat,
      longitude: coords.lng,
      wilaya_code: w || null,
      commune: c || null,
      address,
    });
  }

  function saveManual(e: React.FormEvent) {
    e.preventDefault();
    if (!wilaya) {
      toast.error(t("chooseWilaya"));
      return;
    }
    // Choix manuel d'une zone (pas un point précis) → on EFFACE l'adresse
    // exacte pour que le header affiche bien « commune · wilaya ».
    void save({ wilaya_code: wilaya, commune: commune || null, address: null });
  }

  const gpsLoading = geo.loading || resolving;
  const gpsActive = !!detected;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-bold">
            {t("whereToOrder")}
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground hover:bg-surface-2 rounded-full p-1.5"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      <Button
        type="button"
        size="lg"
        variant="outline"
        className={cn(
          "w-full",
          gpsActive &&
            "border-success-300 bg-success-50 text-success-800 hover:bg-success-100 hover:text-success-900"
        )}
        onClick={useGps}
        disabled={gpsLoading || saving}
      >
        {gpsLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : gpsActive ? (
          <Check className="text-success-700 size-4" />
        ) : (
          <Navigation className="size-4" />
        )}
        {gpsLoading
          ? resolving
            ? t("detectingZone")
            : t("locating")
          : gpsActive
            ? t("myPosition", { display: detected!.display })
            : t("useMyPosition")}
      </Button>

      {gpsActive && !detected!.wilaya_code && (
        <p className="text-warning-700 -mt-2 text-xs">
          {t("wilayaNotRecognized")}
        </p>
      )}

      {/* Carte TOUJOURS visible : choisir directement en déplaçant la carte,
          recentrer sur sa position (bouton GPS sur la carte), ou agrandir en
          plein écran (bouton ⤢). Auto-centrage sur la position actuelle à
          l'ouverture si aucune position mémorisée. */}
      <div className="border-primary-200 bg-primary-50/40 space-y-2 rounded-[12px] border p-3">
        <p className="text-sm font-semibold">{t("adjustExactPosition")}</p>
        <MapPositionPicker
          initial={coords ?? undefined}
          autoLocate={coords == null}
          focusTarget={flyTarget}
          onChange={(p) => setCoords(p)}
          gpsLabel={t("useMyPosition")}
          height={300}
          searchEnabled
          searchPlaceholder={tCheckout("searchAddressPlaceholder")}
        />
        <Button
          type="button"
          className="w-full"
          onClick={confirmFromMap}
          disabled={saving || !coords}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {t("confirmMyPosition")}
        </Button>
      </div>

      <div className="text-muted relative text-center text-[11px] tracking-wider uppercase">
        <span className="bg-surface relative z-10 px-2">
          {t("orChooseManually")}
        </span>
        <span className="border-border absolute inset-x-0 top-1/2 -translate-y-1/2 border-t" />
      </div>

      <form onSubmit={saveManual} className="space-y-3">
        <div className="space-y-1.5">
          <Label>{t("wilaya")}</Label>
          <select
            value={wilaya}
            onChange={(e) => setWilaya(e.target.value)}
            disabled={saving}
            className={cn(
              "border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            )}
          >
            <option value="">{t("selectWilaya")}</option>
            {WILAYAS.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("communeOptional")}</Label>
          {communes.length > 0 ? (
            <select
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              disabled={saving || !wilaya}
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            >
              <option value="">{t("allWilaya")}</option>
              {communes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <Input
              type="text"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              placeholder={t("communePlaceholder")}
              disabled={saving || !wilaya}
            />
          )}
        </div>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPin className="size-4" />
          )}
          {t("save")}
        </Button>
      </form>
    </div>
  );
}
