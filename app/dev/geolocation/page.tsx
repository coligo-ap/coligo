"use client";

import { Crosshair, ExternalLink, MapPin, Pause, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { sharePosition } from "@/lib/native";
import { toast } from "@/components/ui/toast";

export default function DevGeolocationPage() {
  const {
    coords,
    error,
    loading,
    watching,
    requestOnce,
    startWatch,
    stopWatch,
  } = useGeolocation();

  async function onShare() {
    if (!coords) return;
    const res = await sharePosition(coords, "Position commerçant");
    if (res === "shared") toast.success("Position partagée");
    else if (res === "copied") toast.success("Lien Maps copié");
    else toast.error("Partage indisponible");
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Démo géolocalisation
        </h1>
        <p className="text-muted mt-1 text-sm">
          Test du hook <code>useGeolocation</code> + Web Share API.
        </p>
      </header>

      <section className="border-border bg-surface rounded-card-lg space-y-3 border p-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={requestOnce} disabled={loading}>
            <Crosshair className="size-4" />
            {loading ? "Localisation…" : "Position unique"}
          </Button>
          {watching ? (
            <Button variant="outline" onClick={stopWatch}>
              <Pause className="size-4" />
              Stopper le suivi
            </Button>
          ) : (
            <Button variant="outline" onClick={startWatch}>
              <MapPin className="size-4" />
              Démarrer le suivi
            </Button>
          )}
          <Button variant="outline" onClick={onShare} disabled={!coords}>
            <Share2 className="size-4" />
            Partager
          </Button>
        </div>

        {error && (
          <div className="rounded-control border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error.message}{" "}
            <span className="text-rose-500">({error.kind})</span>
          </div>
        )}

        {coords ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Latitude</dt>
            <dd className="text-foreground tabular-nums">
              {coords.latitude.toFixed(6)}
            </dd>
            <dt className="text-muted">Longitude</dt>
            <dd className="text-foreground tabular-nums">
              {coords.longitude.toFixed(6)}
            </dd>
            <dt className="text-muted">Précision</dt>
            <dd className="text-foreground tabular-nums">
              ± {Math.round(coords.accuracy)} m
            </dd>
            <dt className="text-muted">Horodatage</dt>
            <dd className="text-foreground tabular-nums">
              {new Date(coords.timestamp).toLocaleTimeString("fr-DZ")}
            </dd>
          </dl>
        ) : (
          <p className="text-muted text-sm">
            Aucune position pour l&apos;instant.
          </p>
        )}

        {coords && (
          <a
            href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 inline-flex items-center gap-1 text-sm hover:underline"
          >
            Ouvrir dans Google Maps
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </section>
    </main>
  );
}
