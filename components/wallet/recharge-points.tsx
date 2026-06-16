"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Store,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { openNav, getNavPref } from "@/lib/drive/nav";

type Point = {
  wallet_id: string;
  display_name: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  distance_km: number;
};

function fmtDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/**
 * Annuaire « Où recharger » — liste les points de recharge partenaires proches
 * de l'opérateur (livreur / chauffeur / commerçant), triés par distance.
 * Réutilisable dans les 3 espaces. Se masque proprement si rien à proximité.
 */
export function RechargePoints() {
  const {
    coords,
    loading: geoLoading,
    error: geoError,
    requestOnce,
  } = useGeolocation();
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void requestOnce();
  }, [requestOnce]);

  const load = useCallback(async () => {
    if (!coords) return;
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("recharge_points_nearby", {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_limit: 30,
    });
    if (error) setErr("Impossible de charger les Agents Coligo Pay.");
    else setPoints((data ?? []) as Point[]);
    setLoading(false);
  }, [coords]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = geoLoading || loading;

  return (
    <section className="mx-auto w-full max-w-md">
      <header className="mb-3">
        <h1 className="text-foreground text-lg font-bold">Où recharger</h1>
        <p className="text-muted text-sm">
          Agents Coligo Pay près de vous pour recharger votre portefeuille en
          espèces.
        </p>
      </header>

      {/* Géoloc refusée / indisponible */}
      {geoError && !coords && (
        <div className="border-border bg-surface rounded-[16px] border p-5 text-center">
          <MapPin className="text-subtle mx-auto mb-2 size-6" />
          <p className="text-foreground text-sm font-medium">
            Localisation nécessaire
          </p>
          <p className="text-muted mt-1 text-xs">
            Activez la localisation pour trouver les points proches.
          </p>
          <button
            type="button"
            onClick={() => void requestOnce()}
            className="bg-primary-600 mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="size-4" /> Réessayer
          </button>
        </div>
      )}

      {/* Chargement */}
      {busy && !geoError && (
        <div className="text-muted flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" /> Recherche des points…
        </div>
      )}

      {/* Erreur de chargement */}
      {err && (
        <div className="border-border bg-surface text-foreground rounded-[16px] border p-4 text-center text-sm">
          {err}
          <button
            type="button"
            onClick={() => void load()}
            className="text-primary-600 mt-2 block w-full text-sm font-semibold"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Vide */}
      {!busy && !err && points && points.length === 0 && (
        <div className="border-border bg-surface rounded-[16px] border p-6 text-center">
          <Store className="text-subtle mx-auto mb-2 size-6" />
          <p className="text-foreground text-sm font-medium">
            Aucun Agent Coligo Pay à proximité
          </p>
          <p className="text-muted mt-1 text-xs">
            Aucun Agent Coligo Pay n’est disponible près de vous pour le moment.
            Vous pouvez aussi recharger par carte (Chargily) ou virement.
          </p>
        </div>
      )}

      {/* Liste */}
      {!busy && !err && points && points.length > 0 && (
        <ul className="space-y-3">
          {points.map((p) => (
            <li
              key={p.wallet_id}
              className="border-border bg-surface rounded-[16px] border p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
                  <Store className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-foreground truncate text-sm font-semibold">
                      {p.display_name ?? "Agent Coligo Pay"}
                    </p>
                    <span className="bg-primary-50 text-primary-700 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold">
                      {fmtDistance(p.distance_km)}
                    </span>
                  </div>
                  {p.address && (
                    <p className="text-muted mt-0.5 truncate text-xs">
                      {p.address}
                    </p>
                  )}
                  {p.hours && (
                    <p className="text-subtle mt-0.5 text-xs">🕒 {p.hours}</p>
                  )}
                  <p className="text-subtle mt-0.5 text-xs tabular-nums">
                    📍 {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                  </p>
                  {p.phone && (
                    <p className="text-subtle text-xs">📞 {p.phone}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openNav(getNavPref() ?? "google", p.lat, p.lng)
                  }
                  className="bg-primary-600 inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white"
                >
                  <Navigation className="size-4" /> Itinéraire
                </button>
                {p.phone && (
                  <a
                    href={`tel:${p.phone}`}
                    className="border-border text-foreground inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold"
                  >
                    <Phone className="size-4" /> Appeler
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
