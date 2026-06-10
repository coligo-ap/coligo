"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Car, LogOut, MapPin, Navigation } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { PushRegistrar } from "@/components/native/push-registrar";
import {
  cancelRideAction,
  chauffeurHeartbeat,
  chauffeurLogout,
  completeRideAction,
  getMyActiveRide,
  getNearbyRides,
  offerRide,
  setRideStatus,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";

type ActiveRide = Awaited<ReturnType<typeof getMyActiveRide>>;

const ONLINE_KEY = "coligo_chauffeur_online";

export function ChauffeurHome({
  name,
  frozen,
}: {
  name: string;
  frozen: boolean;
}) {
  const router = useRouter();
  const coords = useDriverPosition();
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const [online, setOnline] = useState(false);
  const [rides, setRides] = useState<NearbyRide[]>([]);
  const [active, setActive] = useState<ActiveRide>(null);

  useEffect(() => {
    setOnline(localStorage.getItem(ONLINE_KEY) === "1" && !frozen);
  }, [frozen]);

  const toggleOnline = () => {
    const next = !online;
    setOnline(next);
    localStorage.setItem(ONLINE_KEY, next ? "1" : "0");
  };

  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;
    void chauffeurHeartbeat(c.latitude, c.longitude, true);
    const [near, act] = await Promise.all([
      getNearbyRides(c.latitude, c.longitude),
      getMyActiveRide(),
    ]);
    setActive(act);
    setRides(act ? [] : near); // si course active, on masque la file
  }, []);

  useEffect(() => {
    if (!online) {
      setRides([]);
      return;
    }
    void tick();
    const id = setInterval(tick, 12_000);
    return () => clearInterval(id);
  }, [online, tick]);

  async function doOffer(ride: NearbyRide, price: number) {
    const res = await offerRide(ride.id, price);
    if (!res.ok) return toast.error(res.error ?? "Offre impossible");
    toast.success("Offre envoyée ⚡");
    void tick();
  }

  async function progress(
    s: "arriving" | "arrived" | "in_progress" | "complete" | "cancel"
  ) {
    if (!active) return;
    const res =
      s === "complete"
        ? await completeRideAction(active.id)
        : s === "cancel"
          ? await cancelRideAction(active.id)
          : await setRideStatus(active.id, s);
    if (!res.ok) return toast.error(res.error ?? "Action impossible");
    if (s === "complete") toast.success("Course terminée ✅");
    void tick();
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md p-4">
      {/* Enregistre le token push (rôle chauffeur) → sonnerie des courses */}
      <PushRegistrar role="chauffeur" />
      {/* En-tête */}
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="text-primary-600 size-6" />
          <span className="font-bold">Salut {name.split(" ")[0]}</span>
        </div>
        <form action={chauffeurLogout}>
          <button type="submit" className="text-muted hover:text-danger-600">
            <LogOut className="size-5" />
          </button>
        </form>
      </header>

      {/* Toggle en ligne */}
      <button
        type="button"
        onClick={toggleOnline}
        disabled={frozen}
        className={cn(
          "mb-4 flex w-full items-center justify-between rounded-[16px] px-5 py-4 font-semibold text-white shadow-sm transition-colors disabled:opacity-50",
          online ? "bg-success-600" : "bg-surface-3 text-foreground"
        )}
      >
        <span>
          {online ? "EN LIGNE — tu reçois des courses" : "Hors ligne"}
        </span>
        <span
          className={cn(
            "relative inline-flex h-7 w-12 items-center rounded-full",
            online ? "bg-white/30" : "bg-surface-2"
          )}
        >
          <span
            className={cn(
              "inline-block size-6 transform rounded-full bg-white shadow transition-transform",
              online ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </span>
      </button>
      {frozen && (
        <p className="text-warning-700 mb-4 text-center text-sm">
          Compte temporairement gelé — contacte le support.
        </p>
      )}

      {/* Course active */}
      {active && <ActiveRideCard active={active} onAction={progress} />}

      {/* File de courses proches */}
      {online && !active && (
        <section className="space-y-3">
          <h2 className="text-muted text-sm font-semibold tracking-wide uppercase">
            Courses proches
          </h2>
          {!coords && (
            <p className="text-muted text-sm">Récupération de ta position…</p>
          )}
          {coords && rides.length === 0 && (
            <p className="text-muted bg-surface border-border rounded-[14px] border px-4 py-8 text-center text-sm">
              Aucune course pour le moment. Reste en ligne 👀
            </p>
          )}
          {rides.map((r) => (
            <RideRequestCard key={r.id} ride={r} onOffer={doOffer} />
          ))}
        </section>
      )}
    </div>
  );
}

function RideRequestCard({
  ride,
  onOffer,
}: {
  ride: NearbyRide;
  onOffer: (r: NearbyRide, price: number) => void;
}) {
  const [counter, setCounter] = useState<string>("");
  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold tabular-nums">
          {formatDA(ride.proposed_price_da)}
        </span>
        <span className="text-muted text-xs">
          à {ride.pickup_dist_km.toFixed(1)} km · {ride.distance_km} km de
          course
        </span>
      </div>
      <div className="text-muted mt-2 space-y-1 text-sm">
        <p className="flex items-center gap-1.5">
          <MapPin className="text-success-600 size-3.5" />
          {ride.pickup_text ?? "Départ"}
        </p>
        <p className="flex items-center gap-1.5">
          <Navigation className="text-danger-600 size-3.5" />
          {ride.dest_text ?? "Destination"}
        </p>
        <p className="text-subtle text-xs">
          Paiement :{" "}
          {ride.payment_method === "coligo_pay" ? "Coligo Pay" : "Espèces"}
          {ride.my_offer_da != null &&
            ` · ton offre : ${formatDA(ride.my_offer_da)}`}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => onOffer(ride, ride.proposed_price_da)}
          className="bg-success-600 hover:bg-success-700"
        >
          Accepter {formatDA(ride.proposed_price_da)}
        </Button>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            value={counter}
            onChange={(e) => setCounter(e.target.value)}
            placeholder="Contre-prix"
            className="h-9 w-28"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!Number(counter)}
            onClick={() => onOffer(ride, Number(counter))}
          >
            Proposer
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActiveRideCard({
  active,
  onAction,
}: {
  active: NonNullable<ActiveRide>;
  onAction: (
    s: "arriving" | "arrived" | "in_progress" | "complete" | "cancel"
  ) => void;
}) {
  const s = active.status;
  return (
    <section className="border-primary-200 bg-primary-50 mb-4 rounded-[16px] border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Course en cours</h2>
        <span className="text-lg font-extrabold tabular-nums">
          {formatDA(active.agreed_price_da ?? 0)}
        </span>
      </div>
      <div className="text-muted mt-2 space-y-1 text-sm">
        <p className="flex items-center gap-1.5">
          <MapPin className="text-success-600 size-3.5" />
          {active.pickup_text ?? "Départ"}
        </p>
        <p className="flex items-center gap-1.5">
          <Navigation className="text-danger-600 size-3.5" />
          {active.dest_text ?? "Destination"}
        </p>
        <p className="text-subtle text-xs">
          Paiement :{" "}
          {active.payment_method === "coligo_pay" ? "Coligo Pay" : "Espèces"}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {s === "accepted" && (
          <Button size="sm" onClick={() => onAction("arriving")}>
            Je suis en route
          </Button>
        )}
        {(s === "accepted" || s === "arriving") && (
          <Button size="sm" onClick={() => onAction("arrived")}>
            Je suis arrivé
          </Button>
        )}
        {s === "arrived" && (
          <Button
            size="sm"
            className="bg-success-600 hover:bg-success-700"
            onClick={() => onAction("in_progress")}
          >
            Démarrer la course
          </Button>
        )}
        {s === "in_progress" && (
          <Button
            size="sm"
            className="bg-success-600 hover:bg-success-700"
            onClick={() => onAction("complete")}
          >
            Terminer la course
          </Button>
        )}
        {s !== "in_progress" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction("cancel")}
          >
            Annuler
          </Button>
        )}
      </div>
    </section>
  );
}
