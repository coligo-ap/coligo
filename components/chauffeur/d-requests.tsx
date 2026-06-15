"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  Check,
  Home,
  Loader2,
  Map as MapIcon,
  Zap,
} from "lucide-react";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { createClient } from "@/lib/supabase/client";
import { Place } from "@/lib/geo/place-name";
import { DriveMap } from "@/components/customer/drive/drive-map";
import {
  VIOLET,
  GO,
  ROSE,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import { DNav } from "./d-ui";
import {
  chauffeurHeartbeat,
  declineRide,
  getChauffeurActiveRide,
  getChauffeurGate,
  getChauffeurPlanRate,
  getNearbyRides,
  offerRide,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";
import { HOME_DIR_KEY, isTowardsHome } from "@/lib/drive/geo";

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;
const ago = (iso: string) => {
  const s = Math.max(
    5,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.round(s / 60)} min`;
};

/**
 * Demandes de courses (maquette s-drequests) : tri Plus proches / Mieux
 * payées, boostées en premier (bordure + ⚡), 2 distances, badge violet
 * « Confort demandé », « voir le trajet sur la carte », ajuster ± 20 puis
 * Proposer / Accepter. La 1re acceptation client redirige vers /course.
 */
export function DRequests({ priceStep = 20 }: { priceStep?: number }) {
  const router = useRouter();
  const coords = useDriverPosition();
  const [reqs, setReqs] = useState<NearbyRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"near" | "pay">("near");
  const [myPrices, setMyPrices] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mapReq, setMapReq] = useState<NearbyRide | null>(null);
  // Net estimé : taux de commission du plan (free 8 % / pro / premium).
  const [planRate, setPlanRate] = useState(0.08);
  const [chId, setChId] = useState<string | null>(null);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  useEffect(() => {
    void getChauffeurPlanRate().then(setPlanRate);
  }, []);

  // « Je rentre chez moi » (G4) : toggle partagé avec l'accueil + domicile
  // géocodé + tolérance angulaire (config admin).
  const [homeDir, setHomeDir] = useState<{
    on: boolean;
    addr: string | null;
    lat: number | null;
    lng: number | null;
    tolerance: number;
  }>({ on: false, addr: null, lat: null, lng: null, tolerance: 45 });
  useEffect(() => {
    const on = localStorage.getItem(HOME_DIR_KEY) === "1";
    void getChauffeurGate().then((g) => {
      if (g) {
        setChId(g.id);
        setHomeDir({
          on,
          addr: g.homeAddr,
          lat: g.homeLat,
          lng: g.homeLng,
          tolerance: g.homeDirToleranceDeg,
        });
      }
    });
  }, []);

  const poll = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;
    void chauffeurHeartbeat(c.latitude, c.longitude, true);
    const [list, active] = await Promise.all([
      getNearbyRides(c.latitude, c.longitude),
      getChauffeurActiveRide(),
    ]);
    if (active) {
      router.replace("/chauffeur/course");
      return;
    }
    setReqs(list);
    setLoading(false);
  }, [router]);
  // 1er chargement quasi-immédiat : dès que la position est connue, on
  // interroge sans attendre le tick. Poll de filet à 5 s (le temps réel
  // ci-dessous gère l'instantané) + loader tant que rien n'est arrivé.
  useEffect(() => {
    void poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);
  // Si la géoloc met du temps : déclencher le poll dès la 1re position connue
  // (sans attendre le tick) — puis laisser l'intervalle + le temps réel gérer.
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void poll();
    }
  }, [coords, poll]);

  // Temps réel (mig 0149) : nouvelles demandes instantanées + redirection
  // immédiate quand le client accepte UNE de mes offres.
  useEffect(() => {
    const supabase = createClient();
    const chans = [
      supabase
        .channel("nearby-rides")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "rides" },
          () => void poll()
        )
        .subscribe(),
      ...(chId
        ? [
            supabase
              .channel(`my-offers-${chId}`)
              .on(
                "postgres_changes",
                {
                  event: "UPDATE",
                  schema: "public",
                  table: "ride_offers",
                  filter: `chauffeur_id=eq.${chId}`,
                },
                (payload) => {
                  if (
                    (payload.new as { status?: string }).status === "accepted"
                  )
                    router.replace("/chauffeur/course");
                }
              )
              .subscribe(),
          ]
        : []),
    ];
    return () => {
      for (const c of chans) void supabase.removeChannel(c);
    };
  }, [poll, chId, router]);

  const total = (q: NearbyRide) => q.proposed_price_da + q.boost_amount_da;
  // Filtre directionnel « je rentre chez moi » : ne garder que les demandes
  // dont la destination va vers le domicile (cap ± tolérance ET rapprochement).
  const dirActive = homeDir.on && homeDir.lat != null && homeDir.lng != null;
  const filtered = dirActive
    ? reqs.filter(
        (q) =>
          q.pickup_lat != null &&
          q.dest_lat != null &&
          isTowardsHome(
            { lat: q.pickup_lat, lng: q.pickup_lng! },
            { lat: q.dest_lat, lng: q.dest_lng! },
            { lat: homeDir.lat!, lng: homeDir.lng! },
            homeDir.tolerance
          )
      )
    : reqs;
  const sorted = [...filtered];
  if (sort === "pay") sorted.sort((a, b) => total(b) - total(a));
  else sorted.sort((a, b) => a.pickup_dist_km - b.pickup_dist_km);
  sorted.sort(
    (a, b) => Number(b.boost_amount_da > 0) - Number(a.boost_amount_da > 0)
  );

  const propose = async (q: NearbyRide, price: number) => {
    setErrors((e) => ({ ...e, [q.id]: "" }));
    const res = await offerRide(q.id, price);
    if (res.ok) setSent((s) => ({ ...s, [q.id]: price }));
    else
      setErrors((e) => ({
        ...e,
        [q.id]:
          res.error === "female_only"
            ? "Demande réservée aux conductrices."
            : res.error === "gamme_mismatch"
              ? "Cette demande ne correspond pas à votre gamme."
              : res.error === "below_floor"
                ? "Prix trop bas pour ce trajet — remontez votre offre."
                : (res.error ?? "Proposition impossible"),
      }));
  };

  // Refus explicite : la demande disparaît pour ce chauffeur (mig 0149).
  const decline = async (q: NearbyRide) => {
    setReqs((list) => list.filter((x) => x.id !== q.id));
    await declineRide(q.id);
  };

  // Plancher local de la contre-offre (le serveur fait foi : ~70 % du
  // conseillé) — la contre-offre peut descendre SOUS le prix client.
  const minCounter = (q: NearbyRide) => {
    const ref = q.suggested_price_da > 0 ? q.suggested_price_da : total(q);
    return Math.max(priceStep, Math.round((ref * 0.7) / priceStep) * priceStep);
  };

  /* ── Écran : trajet sur la carte (s-dmap) ── */
  if (mapReq) {
    const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
    const pickup =
      mapReq.pickup_lat != null
        ? { lat: mapReq.pickup_lat, lng: mapReq.pickup_lng! }
        : null;
    const dest =
      mapReq.dest_lat != null
        ? { lat: mapReq.dest_lat, lng: mapReq.dest_lng! }
        : null;
    return (
      <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
        <DriveMap
          markers={[
            ...(me ? [{ id: "car", pos: me, kind: "car" as const }] : []),
            ...(pickup
              ? [{ id: "cli", pos: pickup, kind: "me" as const }]
              : []),
            ...(dest ? [{ id: "dest", pos: dest, kind: "pin" as const }] : []),
          ]}
          approach={me && pickup ? [me, pickup] : null}
          route={pickup && dest ? [pickup, dest] : null}
          padding={{ top: 100, bottom: 280, left: 50, right: 50 }}
        />
        {/* Étiquettes distances posées sur les segments */}
        <div className="pointer-events-none absolute top-[88px] left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <span className="rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--d-muted)] shadow">
            {fmtkm(mapReq.pickup_dist_km)} · approche
          </span>
          <span
            className="rounded-full border-[1.5px] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold shadow"
            style={{ borderColor: VIOLET, color: VIOLET }}
          >
            {fmtkm(mapReq.distance_km)} · course
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMapReq(null)}
          className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span
              className="drive-sora grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white"
              style={{
                background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
              }}
            >
              {mapReq.customer_name[0]?.toUpperCase()}
            </span>
            <span>
              <b className="drive-sora text-sm">
                {mapReq.customer_name}
                {mapReq.gamme === "confort" ? " · Confort" : ""}
              </b>
              <span className="block text-[12px] text-[var(--d-muted)]">
                <Place
                  text={mapReq.pickup_text}
                  lat={mapReq.pickup_lat}
                  lng={mapReq.pickup_lng}
                />{" "}
                →{" "}
                <Place
                  text={mapReq.dest_text}
                  lat={mapReq.dest_lat}
                  lng={mapReq.dest_lng}
                />
              </span>
            </span>
          </div>
          <div className="mb-3 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-full bg-[#B7BBC8]" />
              Vous → client
              <b className="drive-sora ml-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.pickup_dist_km)}
              </b>
            </span>
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-[2px] bg-[var(--d-ink)]" />
              Client → destination
              <b className="drive-sora ml-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.distance_km)}
              </b>
            </span>
          </div>
          <PrimaryBtn onClick={() => setMapReq(null)} className="!mt-0">
            Retour aux demandes
          </PrimaryBtn>
        </div>
      </div>
    );
  }

  /* ── Liste des demandes ── */
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-[18px] pt-3.5 pb-24">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/chauffeur")}
          className="grid size-[42px] shrink-0 place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div>
          <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
            Demandes de courses
          </h1>
          <p className="text-[13px] text-[var(--d-muted)]">
            {filtered.length} clients · ajustez votre prix, puis proposez
          </p>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {(
          [
            ["near", "Plus proches"],
            ["pay", "Mieux payées"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSort(k)}
            className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-xs font-bold"
            style={
              sort === k
                ? { borderColor: VIOLET, background: "#EEEEFD", color: VIOLET }
                : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtre « je rentre chez moi » actif (maquette dirrow) */}
      {dirActive && (
        <div
          className="mb-3 flex items-center gap-2.5 rounded-[14px] px-3.5 py-3"
          style={{ background: "#EEEEFD" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-surface)]">
            <Home className="size-4" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0">
            <b className="block text-[12.5px]" style={{ color: VIOLET }}>
              Filtre actif · vers {homeDir.addr ?? "votre domicile"}
            </b>
            <span className="text-[10.5px] text-[var(--d-muted)]">
              {filtered.length} course{filtered.length > 1 ? "s" : ""} dans
              votre direction
            </span>
          </span>
        </div>
      )}

      {loading && sorted.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="size-7 animate-spin" style={{ color: VIOLET }} />
          <p className="text-sm font-semibold text-[var(--d-muted)]">
            Recherche des demandes autour de vous…
          </p>
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <p className="py-10 text-center text-sm text-[var(--d-muted)]">
          {dirActive
            ? "Aucune course vers votre domicile pour le moment."
            : "Aucune demande autour de vous pour le moment."}
        </p>
      )}

      {sorted.map((q) => {
        const cp = total(q);
        const myPrice = myPrices[q.id] ?? cp;
        const sentPrice = sent[q.id];
        return (
          <div
            key={q.id}
            className="drive-rise mb-3 rounded-[18px] border p-3"
            style={{
              borderColor: q.boost_amount_da > 0 ? GO : "var(--d-line)",
              opacity: sentPrice ? 0.75 : 1,
            }}
          >
            <div className="mb-2.5 flex items-center gap-2.5">
              <span
                className="drive-sora grid size-[42px] shrink-0 place-items-center rounded-full font-extrabold text-white"
                style={{
                  background: q.female_only
                    ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                    : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {q.customer_name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-bold">
                  {q.customer_name}
                  {q.customer_rating != null && (
                    <span className="text-[11.5px] text-[#E8B53C]">
                      ★ {String(q.customer_rating).replace(".", ",")}
                    </span>
                  )}
                  {q.boost_amount_da > 0 && (
                    <span
                      className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold whitespace-nowrap"
                      style={{ background: "rgba(22,179,100,.12)", color: GO }}
                    >
                      <Zap className="size-2.5" /> Boostée
                    </span>
                  )}
                  {q.gamme === "confort" && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
                      style={{ background: "#EEEEFD", color: VIOLET }}
                    >
                      Confort demandé
                    </span>
                  )}
                  {q.female_only && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
                      style={{
                        background: "rgba(236,72,153,.13)",
                        color: ROSE,
                      }}
                    >
                      Femme au volant
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-[var(--d-muted)]">
                  {ago(q.created_at)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <b className="drive-sora block text-lg font-extrabold">
                  {cp} DA
                </b>
                <span className="text-[10px] text-[var(--d-muted)]">
                  prix client
                </span>
              </span>
            </div>

            <div className="mb-2 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
              <span className="flex items-center gap-2">
                <i
                  className="size-[9px] shrink-0 rounded-full"
                  style={{ background: VIOLET }}
                />
                Vous → client
                <b className="drive-sora ml-auto text-[var(--d-ink)]">
                  {fmtkm(q.pickup_dist_km)}
                </b>
              </span>
              <span className="flex items-center gap-2">
                <i className="size-[9px] shrink-0 rounded-[2px] bg-[var(--d-ink)]" />
                Client → destination
                <b className="drive-sora ml-auto text-[var(--d-ink)]">
                  {fmtkm(q.distance_km)}
                </b>
              </span>
            </div>
            <p className="mb-2.5 truncate text-xs font-semibold">
              <Place
                text={q.pickup_text}
                lat={q.pickup_lat}
                lng={q.pickup_lng}
              />{" "}
              → <Place text={q.dest_text} lat={q.dest_lat} lng={q.dest_lng} />
            </p>
            <button
              type="button"
              onClick={() => setMapReq(q)}
              className="mb-2.5 flex items-center gap-1.5 text-xs font-bold"
              style={{ color: VIOLET }}
            >
              <MapIcon className="size-3.5" /> Voir le trajet sur la carte
            </button>

            {sentPrice ? (
              <div
                className="flex h-11 items-center justify-center gap-2 rounded-[13px] text-[13px] font-bold"
                style={{ background: "rgba(22,179,100,.12)", color: GO }}
              >
                <Check className="size-4" /> Proposé à {q.customer_name} ·{" "}
                {sentPrice} DA — en attente
              </div>
            ) : (
              <>
                {/* Acceptation directe ENCOURAGÉE : bouton héro vert, pleine
                    largeur — bien plus visible que la contre-offre. */}
                <button
                  type="button"
                  onClick={() => void propose(q, cp)}
                  className="drive-sora flex h-[54px] w-full items-center justify-center gap-2 rounded-[15px] text-[16px] font-extrabold text-white"
                  style={{
                    background: GO,
                    boxShadow: `0 14px 26px -12px ${GO}`,
                  }}
                >
                  <Check className="size-5" /> Accepter · {cp} DA
                </button>
                <p className="mt-1.5 text-center text-[11px] font-semibold text-[var(--d-muted)]">
                  net estimé ≈{" "}
                  <b style={{ color: GO }}>
                    {Math.round(cp * (1 - planRate))} DA
                  </b>{" "}
                  ·{" "}
                  {Math.round(
                    cp / Math.max(0.5, q.distance_km + q.pickup_dist_km)
                  )}{" "}
                  DA/km
                </p>

                {errors[q.id] && (
                  <p
                    className="mt-2 text-center text-xs font-bold"
                    style={{ color: "#E5484D" }}
                  >
                    {errors[q.id]}
                  </p>
                )}

                {/* Contre-offre : volontairement SECONDAIRE (repliée). */}
                <details className="group mt-2">
                  <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 py-1 text-[12.5px] font-bold [&::-webkit-details-marker]:hidden">
                    <span style={{ color: VIOLET }}>
                      Proposer un autre prix
                    </span>
                    <ChevronDown
                      className="size-3.5 transition-transform group-open:rotate-180"
                      style={{ color: VIOLET }}
                    />
                  </summary>
                  <p className="mt-1 text-center text-[11px] font-semibold text-[var(--d-muted)]">
                    Conseillé :{" "}
                    <b className="text-[var(--d-ink)]">
                      {q.suggested_price_da} DA
                    </b>
                  </p>
                  <div className="my-2.5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setMyPrices((p) => ({
                          ...p,
                          // Contre-offre libre : possible SOUS le prix client,
                          // jamais sous le plancher (serveur = below_floor).
                          [q.id]: Math.max(minCounter(q), myPrice - priceStep),
                        }))
                      }
                      className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                      style={{ color: VIOLET }}
                    >
                      −
                    </button>
                    <span className="min-w-[130px] text-center text-[13px] font-semibold text-[var(--d-muted)]">
                      votre prix{" "}
                      <b className="drive-sora text-xl font-extrabold text-[var(--d-ink)]">
                        {myPrice}
                      </b>{" "}
                      DA
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setMyPrices((p) => ({
                          ...p,
                          [q.id]: myPrice + priceStep,
                        }))
                      }
                      className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                      style={{ color: VIOLET }}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void propose(q, myPrice)}
                    className="drive-sora h-11 w-full rounded-[13px] border-[1.5px] text-[13.5px] font-bold"
                    style={{ borderColor: VIOLET, color: VIOLET }}
                  >
                    Proposer {myPrice} DA
                  </button>
                </details>

                <button
                  type="button"
                  onClick={() => void decline(q)}
                  className="mt-2 block w-full text-center text-[12px] font-bold"
                  style={{ color: RED }}
                >
                  Refuser cette course
                </button>
              </>
            )}
          </div>
        );
      })}

      <DNav />
    </div>
  );
}
