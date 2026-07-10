"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneField } from "@/components/ui/phone-field";
import { getPosition } from "@/lib/native/geolocation";
import { toast } from "@/components/ui/toast";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { MAP_STYLE_URL } from "@/lib/config/map";

/**
 * Sélecteur de position sur carte (MapLibre).
 *
 * Source de tuiles : OpenFreeMap (gratuit, vectoriel, sans clé) — cf.
 * lib/config/map.ts.
 *
 * UX : le marqueur reste au CENTRE du viewport ; le client déplace la carte
 * pour positionner. Bouton « Ma position GPS » qui recentre.
 */

type LatLng = { lat: number; lng: number };

export type AddressPickerProps = {
  initial?: LatLng;
  /** Centre par défaut si pas d'initial — par défaut Alger. */
  defaultCenter?: LatLng;
  onChange: (pos: LatLng) => void;
  className?: string;
};

const DEFAULT_CENTER: LatLng = { lat: 36.7538, lng: 3.0588 }; // Alger

export function AddressPicker({
  initial,
  defaultCenter,
  onChange,
  className,
}: AddressPickerProps) {
  const t = useTranslations("checkout");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [loading, setLoading] = useState(false);

  const start = initial ?? defaultCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        style: MAP_STYLE_URL as never,
        center: [start.lng, start.lat],
        zoom: 14,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      // Re-active explicitement toutes les interactions (déjà actives par
      // défaut, mais on neutralise tout cas où elles seraient coupées).
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.enable();

      const emit = () => {
        const c = map.getCenter();
        onChange({ lat: c.lat, lng: c.lng });
      };
      map.on("moveend", emit);
      // Filet de sécurité : ré-évalue la taille du canvas si le parent a
      // 0 px au montage (transitions, accordéon, etc.).
      setTimeout(() => map.resize(), 100);
      setTimeout(() => map.resize(), 500);
      setTimeout(() => map.resize(), 1500);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // initial/onChange volontairement non listés — le composant gère son
    // cycle de vie une seule fois ; les mutations passent par recenter().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useGps = async () => {
    setLoading(true);
    try {
      const pos = await getPosition();
      mapRef.current?.flyTo({
        center: [pos.longitude, pos.latitude],
        zoom: 16,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("geolocUnavailable"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={"space-y-2 " + (className ?? "")}>
      <div
        className="bg-surface-2 relative w-full overflow-hidden rounded-[12px]"
        style={{ height: 300 }}
      >
        {/* h-full/w-full et NON `absolute inset-0` : la classe `maplibregl-map`
            force position:relative et annulait `inset-0` (carte blanche). */}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "none" }}
        />
        {/* Marqueur central fixe (overlay HTML, plus simple qu'un Marker
            MapLibre que l'on devrait re-syncer à chaque move). */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <MapPin
            className="text-primary-700 size-8 drop-shadow-md"
            fill="currentColor"
          />
        </div>
        <button
          type="button"
          onClick={useGps}
          disabled={loading}
          className="bg-surface border-border absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Crosshair className="size-3.5" />
          )}
          {t("myPosition")}
        </button>
      </div>
    </div>
  );
}

/** Section complète : carte + champ adresse texte + tél alternatif. */
export function AddressForm({
  initial,
  defaultCenter,
  onChange,
}: {
  initial?: {
    lat: number;
    lng: number;
    label?: string;
    address_text?: string | null;
    phone_override?: string | null;
  };
  defaultCenter?: LatLng;
  onChange: (v: {
    lat: number;
    lng: number;
    label: string;
    address_text: string;
    phone_override: string;
  }) => void;
}) {
  const t = useTranslations("checkout");
  const [lat, setLat] = useState(initial?.lat ?? DEFAULT_CENTER.lat);
  const [lng, setLng] = useState(initial?.lng ?? DEFAULT_CENTER.lng);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [text, setText] = useState(initial?.address_text ?? "");
  const [phone, setPhone] = useState(initial?.phone_override ?? "");

  useEffect(() => {
    onChange({
      lat,
      lng,
      label,
      address_text: text,
      phone_override: phone,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, label, text, phone]);

  return (
    <div className="space-y-3">
      {/* Carte plein écran + recherche d'adresse : par défaut la position
          actuelle (autoLocate). « Agrandir » → plein écran avec barre de
          recherche pour trouver précisément le lieu. */}
      <MapPositionPicker
        initial={initial ? { lat: initial.lat, lng: initial.lng } : undefined}
        defaultCenter={defaultCenter}
        autoLocate={!initial}
        searchEnabled
        favoritesEnabled
        searchPlaceholder={t("searchAddressPlaceholder")}
        height={300}
        onChange={(p) => {
          setLat(p.lat);
          setLng(p.lng);
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="addr_label">{t("addressName")}</Label>
          <Input
            id="addr_label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("addressLabelPlaceholder")}
            required
          />
        </div>
        <PhoneField
          name="phone_override"
          label={t("altPhone")}
          defaultValue={initial?.phone_override ?? ""}
          onValueChange={(canonical) => setPhone(canonical ?? "")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="addr_text">{t("addressComplement")}</Label>
        <Input
          id="addr_text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("addressComplementPlaceholder")}
        />
      </div>

      <p className="text-subtle text-xs">
        {t("coordinates", {
          lat: lat.toFixed(5),
          lng: lng.toFixed(5),
        })}
      </p>

      {/* Hidden inputs pour FormData côté <form action={…}>.
          `phone_override` est émis par `PhoneField` lui-même, sous sa forme
          canonique — ne pas le redéclarer ici, `FormData.get` ne retiendrait
          que le premier des deux. */}
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />
      <input type="hidden" name="label" value={label} />
      <input type="hidden" name="address_text" value={text} />
    </div>
  );
}
