"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  PencilLine,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WILAYAS, getWilaya } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { ZoneNotice } from "@/components/zones/zone-notice";
import {
  geocodeCommune,
  reverseGeocode,
  reverseGeocodeAdmin,
  type LatLng,
} from "@/lib/geo/geocode";
import { getPosition } from "@/lib/native/geolocation";

const SELECT_CLASS =
  "appearance-none flex h-11 w-full rounded-[12px] border border-border-strong bg-white pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50";

export type ShopLocationNames = {
  wilaya: string;
  commune: string;
  address: string;
  lat: string;
  lng: string;
};

type Props = {
  /** Noms des champs postés (diffèrent entre inscription et profil). */
  names: ShopLocationNames;
  initial?: {
    wilayaCode?: string | null;
    commune?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  disabled?: boolean;
  /** Inscription : la position DOIT être confirmée explicitement. */
  requireConfirm?: boolean;
  /** Remonte la validité (wilaya + commune + position [+ confirmée]). */
  onValidityChange?: (valid: boolean) => void;
  /**
   * Inscription : « ma position actuelle par défaut ». Bouton dédié + dès
   * qu'un repère est posé sans commune choisie, wilaya + commune + adresse
   * sont DÉDUITES du point (reverse Nominatim), sans re-focus de la carte.
   */
  gpsAutofill?: boolean;
};

/** Normalise un nom de lieu pour la comparaison (accents, « Wilaya de… »). */
function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bwilaya (de |d')?/g, "")
    .replace(/['’‐-]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchWilaya(name: string | null): { code: string } | null {
  if (!name) return null;
  const n = normPlace(name);
  if (!n) return null;
  return (
    WILAYAS.find((w) => normPlace(w.name) === n) ??
    WILAYAS.find(
      (w) => n.includes(normPlace(w.name)) || normPlace(w.name).includes(n)
    ) ??
    null
  );
}

function matchCommune(code: string, name: string | null): string | null {
  if (!name) return null;
  const n = normPlace(name);
  if (!n) return null;
  const list = getCommunes(code);
  return (
    list.find((c) => normPlace(c) === n) ??
    list.find((c) => normPlace(c).includes(n) || n.includes(normPlace(c))) ??
    null
  );
}

/**
 * Sélecteur complet d'emplacement de boutique (Uber-like) :
 * wilaya + commune → la carte se focalise sur la commune → le commerçant place
 * le repère sur l'entrée exacte → confirme. Adresse exacte auto-détectée
 * (modifiable). Réutilisé à l'inscription ET sur le profil.
 */
export function ShopLocationPicker({
  names,
  initial,
  disabled = false,
  requireConfirm = false,
  onValidityChange,
  gpsAutofill = false,
}: Props) {
  const [wilayaCode, setWilayaCode] = useState(initial?.wilayaCode ?? "");
  const [commune, setCommune] = useState(initial?.commune ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [coords, setCoords] = useState<LatLng | null>(
    initial?.lat != null && initial?.lng != null
      ? { lat: initial.lat, lng: initial.lng }
      : null
  );
  // Une position déjà enregistrée vaut « confirmée » (profil). À l'inscription,
  // il faut un clic explicite après avoir bougé le repère.
  const [confirmed, setConfirmed] = useState<boolean>(
    !requireConfirm || coords != null
  );
  const [focusTarget, setFocusTarget] = useState<
    (LatLng & { zoom?: number }) | null
  >(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  // « Ma position actuelle » (gpsAutofill) : état du bouton + note inline.
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const fillSeq = useRef(0);

  const communes = useMemo(() => getCommunes(wilayaCode), [wilayaCode]);
  const hasCommuneList = communes.length > 0;

  // Quand la commune (ou la wilaya) change → focalise la carte sur la zone et
  // demande une nouvelle confirmation. Ne s'applique qu'après un choix humain
  // (on garde la position enregistrée telle quelle au premier rendu).
  const lastGeocoded = useRef<string>("");
  useEffect(() => {
    if (!wilayaCode || !commune) return;
    const key = `${wilayaCode}|${commune}`;
    if (key === lastGeocoded.current) return;
    lastGeocoded.current = key;
    // Au tout premier rendu d'une boutique déjà placée, ne pas re-géocoder
    // (on respecte la position enregistrée).
    if (
      key === `${initial?.wilayaCode ?? ""}|${initial?.commune ?? ""}` &&
      coords != null
    ) {
      return;
    }
    let cancelled = false;
    setGeoLoading(true);
    geocodeCommune(commune, getWilaya(wilayaCode)?.name ?? "")
      .then((c) => {
        if (cancelled || !c) return;
        setFocusTarget({ ...c, zoom: 14 });
        if (requireConfirm) setConfirmed(false);
      })
      .finally(() => {
        if (!cancelled) setGeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wilayaCode, commune]);

  // Validité remontée au parent (gate du bouton submit).
  useEffect(() => {
    const valid =
      !!wilayaCode &&
      !!commune.trim() &&
      coords != null &&
      (!requireConfirm || confirmed);
    onValidityChange?.(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wilayaCode, commune, coords, confirmed, requireConfirm]);

  const onWilaya = (code: string) => {
    setWilayaCode(code);
    // Réinitialise la commune si elle n'existe pas dans la nouvelle wilaya.
    const next = getCommunes(code);
    if (commune && next.length > 0 && !next.includes(commune)) setCommune("");
  };

  /**
   * Déduit wilaya + commune + adresse du point (reverse Nominatim). `force`
   * (bouton dédié) écrase la sélection ; sinon on ne remplit que si aucune
   * commune n'est encore choisie. IMPORTANT : `lastGeocoded` est posé AVANT
   * les setState pour que l'effet de focus commune ne déplace PAS la carte —
   * la position GPS exacte prime sur le centre approximatif de la commune.
   */
  const applyGpsAdminFill = async (p: LatLng, force = false) => {
    const seq = ++fillSeq.current;
    const found = await reverseGeocodeAdmin(p.lat, p.lng);
    if (!found || seq !== fillSeq.current) return;
    const w = matchWilaya(found.wilayaName);
    let filledCommune: string | null = null;
    if (w && (force || !commune)) {
      const list = getCommunes(w.code);
      filledCommune =
        list.length > 0
          ? matchCommune(w.code, found.communeName)
          : (found.communeName?.trim().slice(0, 80) ?? null);
      lastGeocoded.current = `${w.code}|${filledCommune ?? ""}`;
      setWilayaCode(w.code);
      if (filledCommune) setCommune(filledCommune);
    }
    if (found.label && (force || !address.trim())) setAddress(found.label);
    if (filledCommune) {
      setGpsNote(
        "Wilaya, commune et adresse détectées depuis la position — vérifie."
      );
    }
  };

  /** Bouton « Utiliser ma position actuelle » : GPS → repère + déduction. */
  const useMyPosition = async () => {
    setGpsError(null);
    setGpsNote(null);
    setGpsBusy(true);
    try {
      const pos = await getPosition();
      const p = { lat: pos.latitude, lng: pos.longitude };
      setCoords(p);
      setDetected(null);
      if (requireConfirm) setConfirmed(false);
      setFocusTarget({ ...p, zoom: 17 });
      await applyGpsAdminFill(p, true);
    } catch {
      setGpsError(
        "Position indisponible — autorise la localisation, ou place le repère à la main."
      );
    } finally {
      setGpsBusy(false);
    }
  };

  const confirmPosition = async () => {
    if (!coords) return;
    setConfirmed(true);
    setGeoLoading(true);
    const found = await reverseGeocode(coords.lat, coords.lng);
    setGeoLoading(false);
    if (found) {
      setDetected(found);
      // Préremplit l'adresse si le commerçant ne l'a pas saisie.
      if (!address.trim()) setAddress(found);
    }
  };

  return (
    <div className="space-y-4">
      {/* « Ma position actuelle » par défaut (inscription) : un tap remplit
          repère + wilaya + commune + adresse. */}
      {gpsAutofill && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={useMyPosition}
            disabled={disabled || gpsBusy}
            className="border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border text-sm font-semibold disabled:opacity-50"
          >
            {gpsBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4" />
            )}
            Utiliser ma position actuelle
          </button>
          {gpsNote && (
            <p className="text-success-700 flex items-center gap-1 text-xs">
              <Check className="size-3.5 shrink-0" />
              {gpsNote}
            </p>
          )}
          {gpsError && <p className="text-xs text-rose-600">{gpsError}</p>}
        </div>
      )}

      {/* Wilaya + commune */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={names.wilaya}>
            Wilaya <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <MapPin className="text-subtle pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2" />
            <Chevron />
            <select
              id={names.wilaya}
              name={names.wilaya}
              required
              disabled={disabled}
              className={SELECT_CLASS}
              value={wilayaCode}
              onChange={(e) => onWilaya(e.target.value)}
            >
              <option value="">— Sélectionner —</option>
              {WILAYAS.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={names.commune}>
            Commune <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <Building2 className="text-subtle pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2" />
            {hasCommuneList ? (
              <>
                <Chevron />
                <select
                  id={names.commune}
                  name={names.commune}
                  required
                  disabled={disabled || !wilayaCode}
                  className={SELECT_CLASS}
                  value={commune}
                  onChange={(e) => setCommune(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  {communes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <Input
                id={names.commune}
                name={names.commune}
                required
                value={commune}
                onChange={(e) => setCommune(e.target.value)}
                placeholder={
                  wilayaCode ? "Saisir la commune" : "Choisis une wilaya"
                }
                disabled={disabled || !wilayaCode}
                className="pl-9"
              />
            )}
          </div>
        </div>
      </div>

      {/* Carte — position exacte */}
      <div className="space-y-1.5">
        <Label>
          Position exacte de la boutique{" "}
          <span className="text-rose-600">*</span>
        </Label>
        <p className="text-muted text-xs">
          {wilayaCode && commune
            ? "Glisse ou tape sur la carte pour placer le repère sur l'entrée exacte de ta boutique, puis confirme."
            : "Choisis d'abord ta wilaya et ta commune : la carte s'y placera automatiquement."}
        </p>

        <div
          className={cn(
            "overflow-hidden rounded-[14px] border-2 transition-colors",
            confirmed && coords ? "border-success-400" : "border-border-strong"
          )}
        >
          <MapPositionPicker
            initial={coords}
            focusTarget={focusTarget}
            onChange={(p) => {
              setCoords(p);
              setDetected(null);
              if (requireConfirm) setConfirmed(false);
              // Repère posé (GPS auto ou tap) sans commune choisie → déduire
              // wilaya + commune + adresse : « ma position = défaut ».
              if (gpsAutofill && !commune) void applyGpsAdminFill(p);
            }}
            height={240}
            gpsLabel="Ma position"
            autoLocate={requireConfirm && !coords}
            searchEnabled
            searchPlaceholder="Rechercher une adresse, un lieu, un quartier…"
          />
        </div>

        {/* Disponibilité des services de livraison sur ce point (temps réel). */}
        {coords && (
          <ZoneNotice
            lat={coords.lat}
            lng={coords.lng}
            wilayaCode={wilayaCode || null}
            commune={commune || null}
            services={["express", "tour"]}
            role="any"
            className="mt-2"
          />
        )}

        {/* État + confirmation */}
        {confirmed && coords ? (
          <div className="border-success-200 bg-success-50 flex items-start gap-2 rounded-[12px] border p-3">
            <Check className="text-success-700 mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="text-success-800 font-semibold">
                Position confirmée
              </p>
              {(detected || address) && (
                <p className="text-success-700/90 mt-0.5 text-xs">
                  {detected ?? address}
                </p>
              )}
              <p className="text-success-700/70 mt-0.5 font-mono text-[11px]">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              disabled={disabled}
              className="text-success-700 hover:bg-success-100 ml-auto inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-medium"
            >
              <PencilLine className="size-3.5" />
              Modifier
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={confirmPosition}
            disabled={disabled || !coords}
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {geoLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Navigation className="size-4" />
            )}
            {coords
              ? "Confirmer cette position"
              : "Place d'abord le repère sur la carte"}
          </button>
        )}

        {/* Position postée avec le formulaire. */}
        <input
          type="hidden"
          name={names.lat}
          value={coords ? String(coords.lat) : ""}
        />
        <input
          type="hidden"
          name={names.lng}
          value={coords ? String(coords.lng) : ""}
        />
      </div>

      {/* Adresse exacte (auto-détectée, modifiable) */}
      <div className="space-y-1.5">
        <Label htmlFor={names.address}>Adresse exacte</Label>
        <div className="relative">
          <MapPin className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id={names.address}
            name={names.address}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
            placeholder="N°, rue, quartier, point de repère…"
            disabled={disabled}
            className="pl-9"
          />
        </div>
        <p className="text-subtle text-xs">
          Renseignée automatiquement depuis la carte — ajuste-la si besoin.
        </p>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      className="text-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
