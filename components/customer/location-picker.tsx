"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import {
  writeStoredLocation,
  type CustomerLocation,
} from "@/lib/customer/location-store";
import { updateCustomerLocation } from "@/app/(customer)/actions";

type Props = {
  /** Affiche un bouton "Annuler" / "Fermer" en haut à droite. */
  onClose?: () => void;
  /** Localisation actuelle pour préselectionner les champs. */
  initial: CustomerLocation | null;
};

export function LocationPicker({ onClose, initial }: Props) {
  const [wilaya, setWilaya] = useState(initial?.wilaya_code ?? "");
  const [commune, setCommune] = useState(initial?.commune ?? "");
  const [saving, setSaving] = useState(false);
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
    const coords = await geo.requestOnce();
    if (!coords) {
      if (geo.error?.kind === "denied") {
        toast.error("Permission refusée. Choisis ta wilaya manuellement.");
      } else if (geo.error) {
        toast.error(geo.error.message);
      }
      return;
    }
    // En MVP : on stocke lat/long mais on garde la wilaya manuelle si déjà
    // choisie (pas de reverse-geocoding). L'utilisateur précisera la wilaya.
    await save({
      latitude: coords.latitude,
      longitude: coords.longitude,
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
        className="w-full"
        onClick={useGps}
        disabled={geo.loading || saving}
      >
        {geo.loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Navigation className="size-4" />
        )}
        Utiliser ma position
      </Button>

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
