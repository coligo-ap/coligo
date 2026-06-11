"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Map as MapIcon, Zap } from "lucide-react";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { DriveMap } from "@/components/customer/drive/drive-map";
import {
  VIOLET,
  GO,
  ROSE,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import { DNav } from "./d-ui";
import {
  chauffeurHeartbeat,
  getChauffeurActiveRide,
  getNearbyRides,
  offerRide,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";

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
  const [sort, setSort] = useState<"near" | "pay">("near");
  const [myPrices, setMyPrices] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mapReq, setMapReq] = useState<NearbyRide | null>(null);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

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
  }, [router]);
  useEffect(() => {
    void poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, [poll]);

  const total = (q: NearbyRide) => q.proposed_price_da + q.boost_amount_da;
  const sorted = [...reqs];
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
              : (res.error ?? "Proposition impossible"),
      }));
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
      <div className="drive-jakarta fixed inset-0 bg-[#E9EBF1]">
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
          <span className="rounded-full border-[1.5px] border-[#EEF0F4] bg-white px-3 py-1.5 text-[11px] font-extrabold text-[#6B7280] shadow">
            {fmtkm(mapReq.pickup_dist_km)} · approche
          </span>
          <span
            className="rounded-full border-[1.5px] bg-white px-3 py-1.5 text-[11px] font-extrabold shadow"
            style={{ borderColor: VIOLET, color: VIOLET }}
          >
            {fmtkm(mapReq.distance_km)} · course
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMapReq(null)}
          className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[#EEF0F4] bg-white shadow-lg"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[#EEF0F4] bg-white px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
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
              <span className="block text-[12px] text-[#6B7280]">
                {mapReq.pickup_text ?? "—"} → {mapReq.dest_text ?? "—"}
              </span>
            </span>
          </div>
          <div className="mb-3 flex flex-col gap-1.5 rounded-[12px] bg-[#F4F5F9] px-3 py-2.5 text-[12.5px] font-semibold text-[#6B7280]">
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-full bg-[#B7BBC8]" />
              Vous → client
              <b className="drive-sora ml-auto text-[#0B0C12]">
                {fmtkm(mapReq.pickup_dist_km)}
              </b>
            </span>
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-[2px] bg-[#0B0C12]" />
              Client → destination
              <b className="drive-sora ml-auto text-[#0B0C12]">
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
    <div className="drive-jakarta min-h-screen bg-white px-[18px] pt-3.5 pb-24">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/chauffeur")}
          className="grid size-[42px] shrink-0 place-items-center rounded-[14px] border border-[#EEF0F4] bg-white shadow"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div>
          <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
            Demandes de courses
          </h1>
          <p className="text-[13px] text-[#6B7280]">
            {reqs.length} clients · ajustez votre prix, puis proposez
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
                : { borderColor: "#EEF0F4", color: "#6B7280" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="py-10 text-center text-sm text-[#6B7280]">
          Aucune demande autour de vous pour le moment.
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
              borderColor: q.boost_amount_da > 0 ? GO : "#EEF0F4",
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
                <span className="block text-[11px] text-[#6B7280]">
                  {ago(q.created_at)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <b className="drive-sora block text-lg font-extrabold">
                  {cp} DA
                </b>
                <span className="text-[10px] text-[#6B7280]">prix client</span>
              </span>
            </div>

            <div className="mb-2 flex flex-col gap-1.5 rounded-[12px] bg-[#F4F5F9] px-3 py-2.5 text-[12.5px] font-semibold text-[#6B7280]">
              <span className="flex items-center gap-2">
                <i
                  className="size-[9px] shrink-0 rounded-full"
                  style={{ background: VIOLET }}
                />
                Vous → client
                <b className="drive-sora ml-auto text-[#0B0C12]">
                  {fmtkm(q.pickup_dist_km)}
                </b>
              </span>
              <span className="flex items-center gap-2">
                <i className="size-[9px] shrink-0 rounded-[2px] bg-[#0B0C12]" />
                Client → destination
                <b className="drive-sora ml-auto text-[#0B0C12]">
                  {fmtkm(q.distance_km)}
                </b>
              </span>
            </div>
            <p className="mb-2.5 truncate text-xs font-semibold">
              {q.pickup_text ?? "—"} → {q.dest_text ?? "—"}
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
                <div className="mb-2.5 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setMyPrices((p) => ({
                        ...p,
                        [q.id]: Math.max(cp, myPrice - priceStep),
                      }))
                    }
                    className="grid size-10 place-items-center rounded-full border-[1.5px] border-[#EEF0F4] bg-white text-xl font-bold"
                    style={{ color: VIOLET }}
                  >
                    −
                  </button>
                  <span className="min-w-[130px] text-center text-[13px] font-semibold text-[#6B7280]">
                    votre prix{" "}
                    <b className="drive-sora text-xl font-extrabold text-[#0B0C12]">
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
                    className="grid size-10 place-items-center rounded-full border-[1.5px] border-[#EEF0F4] bg-white text-xl font-bold"
                    style={{ color: VIOLET }}
                  >
                    +
                  </button>
                </div>
                {errors[q.id] && (
                  <p
                    className="mb-2 text-center text-xs font-bold"
                    style={{ color: "#E5484D" }}
                  >
                    {errors[q.id]}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void propose(q, myPrice)}
                    className="drive-sora h-11 flex-1 rounded-[13px] text-[13.5px] font-bold text-white"
                    style={{ background: VIOLET }}
                  >
                    Proposer {myPrice}
                  </button>
                  <button
                    type="button"
                    onClick={() => void propose(q, cp)}
                    className="drive-sora h-11 flex-1 rounded-[13px] bg-[#F4F5F9] text-[13.5px] font-bold"
                  >
                    Accepter {cp}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}

      <DNav />
    </div>
  );
}
