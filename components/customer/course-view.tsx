"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Car, Loader2, MapPin, Navigation, Phone, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { getPosition } from "@/lib/native/geolocation";
import { reverseGeocode } from "@/app/(customer)/actions";
import { haversineKm } from "@/lib/delivery/distance";
import {
  acceptOffer,
  cancelMyRide,
  getMyActiveRide,
  getRideOffers,
  getVtcQuote,
  requestRide,
  type CustomerActiveRide,
} from "@/app/(customer)/course/actions";

type Pt = { lat: number; lng: number; text: string | null };
type Offer = Awaited<ReturnType<typeof getRideOffers>>[number];

const STATUS_LABEL: Record<string, string> = {
  searching: "Recherche d'un chauffeur…",
  accepted: "Chauffeur en route 🚗",
  arriving: "Chauffeur en route 🚗",
  arrived: "Chauffeur arrivé — rejoins-le",
  in_progress: "En course vers ta destination",
};

export function CourseView() {
  const [active, setActive] = useState<CustomerActiveRide | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Sondage de la course active (toutes les 4 s).
  const refresh = useCallback(async () => {
    setActive(await getMyActiveRide());
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!loaded) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="text-primary-600 size-6 animate-spin" />
      </div>
    );
  }

  if (!active) return <RequestForm onRequested={refresh} />;
  if (active.status === "searching")
    return <Searching ride={active} onChange={refresh} />;
  return <ActiveRide ride={active} onChange={refresh} />;
}

/* ─────────────────────────── DEMANDE ─────────────────────────── */

function RequestForm({ onRequested }: { onRequested: () => void }) {
  const [pickup, setPickup] = useState<Pt | null>(null);
  const [dest, setDest] = useState<Pt | null>(null);
  const [suggested, setSuggested] = useState(0);
  const [price, setPrice] = useState("");
  const [payment, setPayment] = useState<"cash" | "coligo_pay">("cash");
  const [submitting, setSubmitting] = useState(false);

  // Position de départ = GPS, une fois.
  useEffect(() => {
    void (async () => {
      try {
        const c = await getPosition();
        const r = await reverseGeocode({
          latitude: c.latitude,
          longitude: c.longitude,
        });
        setPickup({
          lat: c.latitude,
          lng: c.longitude,
          text: r?.display ?? "Ma position",
        });
      } catch {
        /* l'utilisateur pourra quand même choisir la destination */
      }
    })();
  }, []);

  const distanceKm =
    pickup && dest
      ? Number(
          haversineKm(
            { lat: pickup.lat, lng: pickup.lng },
            { lat: dest.lat, lng: dest.lng }
          ).toFixed(2)
        )
      : 0;

  // Prix suggéré quand la distance change.
  useEffect(() => {
    if (distanceKm <= 0) return;
    void (async () => {
      const s = await getVtcQuote(distanceKm);
      setSuggested(s);
      setPrice((p) => (p === "" ? String(s) : p));
    })();
  }, [distanceKm]);

  async function onDestChange(p: { lat: number; lng: number }) {
    setDest({ lat: p.lat, lng: p.lng, text: null });
    const r = await reverseGeocode({ latitude: p.lat, longitude: p.lng });
    setDest({ lat: p.lat, lng: p.lng, text: r?.display ?? null });
  }

  async function submit() {
    if (!pickup || !dest) return toast.error("Choisis ta destination");
    const proposed = Math.max(0, Math.floor(Number(price) || suggested));
    setSubmitting(true);
    const res = await requestRide({
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      pickup_text: pickup.text,
      dest_lat: dest.lat,
      dest_lng: dest.lng,
      dest_text: dest.text,
      distance_km: distanceKm,
      proposed_price_da: proposed,
      payment_method: payment,
    });
    setSubmitting(false);
    if (!res.ok) return toast.error(res.error ?? "Demande impossible");
    onRequested();
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <header className="mb-4 flex items-center gap-2">
        <Car className="text-primary-600 size-6" />
        <h1 className="text-xl font-bold">Commander une course</h1>
      </header>

      <div className="border-border bg-surface mb-4 space-y-1.5 rounded-[14px] border p-4 text-sm">
        <p className="flex items-center gap-2">
          <MapPin className="text-success-600 size-4" />
          <span className="truncate">{pickup?.text ?? "Localisation…"}</span>
        </p>
        <p className="flex items-center gap-2">
          <Navigation className="text-danger-600 size-4" />
          <span className="truncate">
            {dest?.text ?? "Choisis ta destination sur la carte"}
          </span>
        </p>
      </div>

      <p className="text-muted mb-2 text-xs font-medium">
        Pointe ta destination
      </p>
      <div className="mb-4 overflow-hidden rounded-[16px]">
        <MapPositionPicker
          onChange={onDestChange}
          height={260}
          gpsLabel="Ma position"
        />
      </div>

      {distanceKm > 0 && (
        <div className="space-y-4">
          <div className="border-border bg-surface flex items-center justify-between rounded-[14px] border px-4 py-3 text-sm">
            <span className="text-muted">Distance · prix conseillé</span>
            <span className="font-semibold">
              {distanceKm} km · {formatDA(suggested)}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ton prix (négociable)</label>
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pr-10 text-lg font-bold"
              />
              <span className="text-muted absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                DA
              </span>
            </div>
            <p className="text-subtle text-xs">
              Les chauffeurs proches verront ton prix et pourront
              l&apos;accepter ou en proposer un autre.
            </p>
          </div>

          <div className="flex gap-2">
            {(["cash", "coligo_pay"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayment(m)}
                className={cn(
                  "flex-1 rounded-[12px] border px-3 py-2.5 text-sm font-semibold",
                  payment === m
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-border text-muted"
                )}
              >
                {m === "cash" ? "Espèces" : "Coligo Pay"}
              </button>
            ))}
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={submitting || !dest}
            onClick={submit}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Car className="size-4" />
            )}
            Demander la course
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── RECHERCHE / OFFRES ─────────────────────── */

function Searching({
  ride,
  onChange,
}: {
  ride: CustomerActiveRide;
  onChange: () => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState(false);
  const rideId = ride.id;

  const poll = useCallback(async () => {
    setOffers(await getRideOffers(rideId));
  }, [rideId]);
  useEffect(() => {
    void poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [poll]);

  async function choose(offerId: string) {
    setBusy(true);
    const res = await acceptOffer(offerId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Impossible");
    onChange();
  }

  async function cancel() {
    const res = await cancelMyRide(rideId);
    if (!res.ok) return toast.error(res.error ?? "Impossible");
    onChange();
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Loader2 className="text-primary-600 size-5 animate-spin" />
          Recherche d&apos;un chauffeur…
        </h1>
        <button onClick={cancel} className="text-muted hover:text-danger-600">
          <X className="size-5" />
        </button>
      </div>
      <p className="text-muted mb-4 text-sm">
        Ta proposition : <strong>{formatDA(ride.proposed_price_da)}</strong> ·{" "}
        {ride.distance_km} km
      </p>

      {offers.length === 0 ? (
        <div className="border-border bg-surface rounded-[16px] border px-4 py-10 text-center">
          <p className="text-muted text-sm">
            On prévient les chauffeurs autour de toi. Leurs offres vont
            apparaître ici…
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => (
            <li
              key={o.id}
              className="border-border bg-surface flex items-center justify-between gap-3 rounded-[16px] border p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold">{o.chauffeur_name}</p>
                {o.vehicle && <p className="text-muted text-xs">{o.vehicle}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold tabular-nums">
                  {formatDA(o.price_da)}
                </span>
                <Button size="sm" disabled={busy} onClick={() => choose(o.id)}>
                  Choisir
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={cancel}
        className="text-muted mt-6 w-full text-center text-sm font-medium"
      >
        Annuler la demande
      </button>
    </div>
  );
}

/* ─────────────────────────── SUIVI ─────────────────────────── */

function ActiveRide({
  ride,
  onChange,
}: {
  ride: CustomerActiveRide;
  onChange: () => void;
}) {
  // Détecte la complétion : quand la course quitte les statuts actifs, le poll
  // renvoie null → onChange ramène au formulaire. Ici on affiche le suivi.
  async function cancel() {
    const res = await cancelMyRide(ride.id);
    if (!res.ok) return toast.error(res.error ?? "Impossible");
    onChange();
  }

  const ch = ride.chauffeur;
  return (
    <div className="mx-auto max-w-md p-4">
      <section className="from-primary-600 to-primary-700 mb-4 rounded-[20px] bg-gradient-to-br p-5 text-white">
        <p className="text-sm font-medium text-white/85">
          {STATUS_LABEL[ride.status] ?? ride.status}
        </p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums">
          {formatDA(ride.agreed_price_da ?? ride.proposed_price_da)}
        </p>
      </section>

      {ch && (
        <div className="border-border bg-surface mb-4 flex items-center justify-between gap-3 rounded-[16px] border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary-50 text-primary-700 grid size-11 place-items-center rounded-full">
              <Car className="size-5" />
            </div>
            <div>
              <p className="font-semibold">{ch.full_name}</p>
              <p className="text-muted text-xs">
                {ch.vehicle ?? "Véhicule"}
                {ch.plate ? ` · ${ch.plate}` : ""}
              </p>
            </div>
          </div>
          {ch.phone && (
            <a
              href={`tel:${ch.phone}`}
              className="bg-success-600 grid size-11 place-items-center rounded-full text-white"
            >
              <Phone className="size-5" />
            </a>
          )}
        </div>
      )}

      <div className="border-border bg-surface space-y-1.5 rounded-[14px] border p-4 text-sm">
        <p className="flex items-center gap-2">
          <MapPin className="text-success-600 size-4" />
          <span className="truncate">{ride.pickup_text ?? "Départ"}</span>
        </p>
        <p className="flex items-center gap-2">
          <Navigation className="text-danger-600 size-4" />
          <span className="truncate">{ride.dest_text ?? "Destination"}</span>
        </p>
        <p className="text-subtle text-xs">
          Paiement :{" "}
          {ride.payment_method === "coligo_pay" ? "Coligo Pay" : "Espèces"} ·{" "}
          {ride.distance_km} km
        </p>
      </div>

      {ride.status !== "in_progress" && (
        <button
          onClick={cancel}
          className="text-danger-600 mt-5 w-full text-center text-sm font-semibold"
        >
          Annuler la course
        </button>
      )}
    </div>
  );
}
