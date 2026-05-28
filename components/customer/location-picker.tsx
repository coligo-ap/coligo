"use client";

import { useEffect, useMemo, useState } from "react";
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
  // True quand le user a ouvert la carte pour ajuster sa position.
  const [showMap, setShowMap] = useState(false);
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
      toast.success("Localisation enregistrée");
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  async function useGps() {
    setDetected(null);
    const gpsCoords = await geo.requestOnce();
    if (!gpsCoords) {
      if (geo.error?.kind === "denied") {
        toast.error("Permission refusée. Choisis ta wilaya manuellement.");
      } else if (geo.error) {
        toast.error(geo.error.message);
      }
      return;
    }
    setCoords({ lat: gpsCoords.latitude, lng: gpsCoords.longitude });
    setShowMap(true);

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
      toast.error("Position non définie.");
      return;
    }
    await save({
      latitude: coords.lat,
      longitude: coords.lng,
      wilaya_code: wilaya || null,
      commune: commune || null,
    });
  }

  function saveManual(e: React.FormEvent) {
    e.preventDefault();
    if (!wilaya) {
      toast.error("Choisis une wilaya.");
      return;
    }
    void save({ wilaya_code: wilaya, commune: commune || null });
  }

  const gpsLoading = geo.loading || resolving;
  const gpsActive = !!detected;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-bold">
            Où veux-tu commander ?
          </h2>
          <p className="text-muted mt-0.5 text-xs">
            On t&apos;affiche les commerces à proximité.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground hover:bg-surface-2 rounded-full p-1.5"
            aria-label="Fermer"
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
            ? "Détection de ta zone…"
            : "Localisation en cours…"
          : gpsActive
            ? `Ma position : ${detected!.display}`
            : "Utiliser ma position"}
      </Button>

      {gpsActive && !detected!.wilaya_code && (
        <p className="text-warning-700 -mt-2 text-xs">
          On a tes coordonnées mais pas réussi à reconnaître la wilaya —
          précise-la ci-dessous.
        </p>
      )}

      {/* Carte d'ajustement — visible quand le user a cliqué GPS ou a déjà
          des coordonnées en mémoire. Permet d'ajuster le point exact en
          déplaçant le marqueur central avant de confirmer. */}
      {(showMap || coords) && (
        <div className="border-primary-200 bg-primary-50/40 space-y-2 rounded-[12px] border p-3">
          <p className="text-sm font-semibold">Ajuste ta position exacte</p>
          <p className="text-muted text-xs">
            Déplace la carte pour pointer ta vraie position. Le curseur indique
            où tu es.
          </p>
          <MapPositionPicker
            initial={coords ?? undefined}
            onChange={(p) => setCoords(p)}
            gpsLabel="GPS"
            height={260}
          />
          {coords && (
            <p className="text-subtle text-xs tabular-nums">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </p>
          )}
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
            Confirmer ma position
          </Button>
        </div>
      )}

      <div className="text-muted relative text-center text-[11px] tracking-wider uppercase">
        <span className="bg-surface relative z-10 px-2">
          ou choisis manuellement
        </span>
        <span className="border-border absolute inset-x-0 top-1/2 -translate-y-1/2 border-t" />
      </div>

      <form onSubmit={saveManual} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Wilaya</Label>
          <select
            value={wilaya}
            onChange={(e) => setWilaya(e.target.value)}
            disabled={saving}
            className={cn(
              "border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            )}
          >
            <option value="">— Sélectionne une wilaya —</option>
            {WILAYAS.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Commune (optionnel)</Label>
          {communes.length > 0 ? (
            <select
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              disabled={saving || !wilaya}
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            >
              <option value="">— Toute la wilaya —</option>
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
              placeholder="Nom de la commune"
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
          Enregistrer
        </Button>
      </form>
    </div>
  );
}
