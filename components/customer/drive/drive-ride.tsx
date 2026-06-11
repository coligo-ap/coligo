"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDownUp,
  BadgeCheck,
  CreditCard,
  Gift,
  Loader2,
  MessageSquare,
  Phone,
  Share2,
  Star,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { haversineKm } from "@/lib/delivery/distance";
import { DriveMap } from "./drive-map";
import {
  CancelModal,
  ChatModal,
  GhostBtn,
  PrimaryBtn,
  ReportModal,
  ShareModal,
  SOSModal,
  GO,
  ROSE,
  RED,
  VIOLET,
} from "./drive-modals";
import {
  acceptDriveOffer,
  boostRide,
  cancelDriveRide,
  createRideCardCheckout,
  getDriveLastRide,
  getDriveOffers,
  rateDriveRide,
  reportDriveRide,
  toggleFavoriteChauffeur,
  type DriveActiveRide,
  type DriveContext,
  type DriveLastRide,
  type DriveOffer,
} from "@/app/(customer)/drive/actions";

/**
 * Drive client — phase course : offres des chauffeurs (triables, favoris en
 * tête), suivi temps réel (fiche chauffeur v3, partage, SOS, itinéraire
 * anormal), fin de course (récap, cashback, notation, signalement).
 */

export function DriveRide({
  ctx,
  active,
  offlineQueued,
  refreshActive,
  onExit,
  onBackToPrice,
}: {
  ctx: DriveContext;
  active: DriveActiveRide | null;
  offlineQueued: boolean;
  refreshActive: () => Promise<DriveActiveRide | null>;
  onExit: () => void;
  onBackToPrice: () => void;
}) {
  const [done, setDone] = useState<DriveLastRide>(null);
  const [cancelled, setCancelled] = useState<{
    reason: string | null;
    mine: boolean;
  } | null>(null);
  const lastStatus = useRef<string | null>(active?.status ?? null);

  // Poll de la course active + détection de transition (terminée / annulée).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const ride = await refreshActive();
      if (stop) return;
      if (!ride && lastStatus.current && !cancelled) {
        const last = await getDriveLastRide();
        if (stop) return;
        if (last?.status === "completed") setDone(last);
        else if (last) setCancelled({ reason: null, mine: false });
        lastStatus.current = null;
        return;
      }
      if (ride) lastStatus.current = ride.status;
    };
    const id = setInterval(tick, 4000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshActive]);

  if (done) return <DoneScreen ride={done} onExit={onExit} />;
  if (cancelled)
    return (
      <CancelledScreen
        reason={cancelled.reason}
        mine={cancelled.mine}
        onExit={onExit}
      />
    );
  if (!active || active.status === "searching")
    return (
      <SearchScreen
        ctx={ctx}
        ride={active}
        offlineQueued={offlineQueued}
        refreshActive={refreshActive}
        onCancelled={(reason) => setCancelled({ reason, mine: true })}
        onBackToPrice={onBackToPrice}
      />
    );
  return (
    <EnrouteScreen
      ctx={ctx}
      ride={active}
      onCancelled={(reason) => setCancelled({ reason, mine: true })}
    />
  );
}

/* ════════════════ OFFRES DES CHAUFFEURS (triables) ════════════════ */

function SearchScreen({
  ctx,
  ride,
  offlineQueued,
  refreshActive,
  onCancelled,
  onBackToPrice,
}: {
  ctx: DriveContext;
  ride: DriveActiveRide | null;
  offlineQueued: boolean;
  refreshActive: () => Promise<DriveActiveRide | null>;
  onCancelled: (reason: string) => void;
  onBackToPrice: () => void;
}) {
  const t = useTranslations("drive.search");
  const [offers, setOffers] = useState<DriveOffer[]>([]);
  const [sort, setSort] = useState<"cheap" | "rated">("cheap");
  const [busy, setBusy] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rideId = ride?.id ?? null;

  useEffect(() => {
    if (!rideId) return;
    let stop = false;
    const poll = async () => {
      const o = await getDriveOffers(rideId);
      if (!stop) setOffers(o);
    };
    void poll();
    const id = setInterval(poll, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [rideId]);

  const sorted = useMemo(() => {
    const list = [...offers];
    if (sort === "cheap")
      list.sort(
        (a, b) => a.price_da - b.price_da || (b.rating ?? 0) - (a.rating ?? 0)
      );
    else
      list.sort(
        (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.price_da - b.price_da
      );
    list.sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
    return list;
  }, [offers, sort]);
  const minPrice = Math.min(...offers.map((o) => o.price_da));
  const maxRating = Math.max(...offers.map((o) => o.rating ?? 0));
  const femaleFallback =
    !!ride?.female_only && offers.some((o) => !o.is_female);

  const boosted = (ride?.boost_amount_da ?? 0) > 0;
  const boostDefault = Math.max(
    ctx.boostMin,
    Math.round(((ride?.proposed_price_da ?? 0) * ctx.boostDefaultRate) / 5) * 5
  );

  const choose = async (offerId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await acceptDriveOffer(offerId, `acc-${offerId}`);
    if (!res.ok)
      setError(
        res.error === "chauffeur_busy" ? t("driverBusy") : (res.error ?? null)
      );
    await refreshActive();
    setBusy(false);
  };

  return (
    <div className="drive-jakarta fixed inset-0 z-40 bg-[#E9EBF1]">
      {ride?.pickup_lat != null && (
        <DriveMap
          markers={[
            {
              id: "me",
              pos: { lat: ride.pickup_lat, lng: ride.pickup_lng! },
              kind: "me",
            },
          ]}
          padding={{ top: 80, bottom: 500, left: 60, right: 60 }}
        />
      )}
      <div className="absolute inset-x-0 top-[230px] bottom-0 z-10 overflow-y-auto rounded-t-[28px] border-t border-[#EEF0F4] bg-white px-5 pt-3.5 pb-8 shadow-[0_-16px_40px_-22px_rgba(20,22,40,.3)]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[#EEF0F4]" />

        {/* Statut de recherche */}
        <div
          className="mb-2.5 flex items-center gap-2 text-[13px] font-bold"
          style={{ color: VIOLET }}
        >
          {!offlineQueued && (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-[#EEEEFD]"
              style={{ borderTopColor: VIOLET }}
            />
          )}
          {offlineQueued
            ? t("offlineTitle")
            : offers.length > 0
              ? t("responded", { count: offers.length })
              : t("incoming")}
        </div>

        {boosted && (
          <span
            className="mb-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            <Zap className="size-3.5" />{" "}
            {t("boostedChip", { amount: ride?.boost_amount_da ?? 0 })}
          </span>
        )}

        {/* Hors connexion : demande en file (maquette offbanner) */}
        {offlineQueued && (
          <div className="mb-3 flex items-start gap-2.5 rounded-[15px] border-[1.5px] border-dashed border-[#6B7280] bg-[#F4F5F9] p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white">
              <WifiOff className="size-4.5 text-[#6B7280]" />
            </span>
            <span>
              <b className="block text-[13px]">{t("offlineTitle")}</b>
              <span className="text-[11px] leading-snug text-[#6B7280]">
                {t("offlineSub")}
              </span>
            </span>
          </div>
        )}

        {/* Boostez (relançable pendant la recherche) */}
        {ride && !boosted && !offlineQueued && (
          <button
            type="button"
            disabled={boosting}
            onClick={async () => {
              setBoosting(true);
              await boostRide(ride.id, boostDefault);
              await refreshActive();
              setBoosting(false);
            }}
            className="mb-3 flex w-full items-center gap-3 rounded-[14px] p-3 text-left disabled:opacity-50"
            style={{ background: "rgba(22,179,100,.12)" }}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white">
              <Zap className="size-4" style={{ color: GO }} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[12.5px]" style={{ color: GO }}>
                {t("boostBar", { amount: boostDefault })}
              </b>
              <span className="text-[10.5px] text-[#6B7280]">
                {t("boostBarSub")}
              </span>
            </span>
            <span
              className="drive-sora text-base font-extrabold"
              style={{ color: GO }}
            >
              +{boostDefault}
            </span>
          </button>
        )}

        {/* Tri */}
        <div className="mb-3 flex gap-2">
          {(
            [
              ["cheap", t("sortCheap")],
              ["rated", t("sortRated")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-xs font-bold"
              style={
                sort === k
                  ? {
                      borderColor: VIOLET,
                      background: "#EEEEFD",
                      color: VIOLET,
                    }
                  : { borderColor: "#EEF0F4", color: "#6B7280" }
              }
            >
              <ArrowDownUp className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Repli conductrices */}
        {femaleFallback && (
          <div className="mb-2.5 flex items-start gap-2.5 rounded-[13px] border border-[#EEF0F4] bg-[#F4F5F9] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold text-[#6B7280]">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              style={{ color: ROSE }}
            />
            <span>
              <b className="text-[#0B0C12]">{t("femaleFallbackTitle")}</b>{" "}
              {t("femaleFallbackSub")}
            </span>
          </div>
        )}

        {error && (
          <p
            className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
            style={{ background: "rgba(229,72,77,.1)", color: RED }}
          >
            {error}
          </p>
        )}

        {/* Offres */}
        <div>
          {sorted.map((o) => {
            const female = !!ride?.female_only;
            const tone = female ? (o.is_female ? ROSE : "#0B0C12") : undefined;
            let tag: React.ReactNode = null;
            if (o.is_favorite)
              tag = (
                <Tag color={VIOLET} soft="#EEEEFD">
                  ♥ {t("tagFav")}
                </Tag>
              );
            else if (sort === "cheap" && o.price_da === minPrice)
              tag = (
                <Tag color={GO} soft="rgba(22,179,100,.12)">
                  {t("tagCheapest")}
                </Tag>
              );
            else if (sort === "rated" && (o.rating ?? 0) === maxRating)
              tag = (
                <Tag color={GO} soft="rgba(22,179,100,.12)">
                  {t("tagBestRated")}
                </Tag>
              );
            return (
              <div
                key={o.id}
                className="drive-rise mb-2 flex items-center gap-3 rounded-[18px] border bg-[#F4F5F9] p-3"
                style={{
                  borderColor: female
                    ? o.is_female
                      ? ROSE
                      : "#0B0C12"
                    : "#EEF0F4",
                }}
              >
                <span
                  className="drive-sora grid size-11 shrink-0 place-items-center rounded-full text-base font-extrabold text-white"
                  style={{
                    background:
                      tone === "#0B0C12"
                        ? "#0B0C12"
                        : tone === ROSE
                          ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                          : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                  }}
                >
                  {o.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="flex flex-wrap items-center gap-1.5 text-sm leading-tight font-bold"
                    style={{ color: tone }}
                  >
                    {o.name}
                    {o.rating != null && (
                      <span className="text-[11px] text-[#E8B53C]">
                        ★ {String(o.rating).replace(".", ",")}
                      </span>
                    )}
                    {o.is_premium && (
                      <span className="rounded-full bg-[#E8B53C] px-2 py-0.5 text-[9.5px] font-extrabold text-[#3a2c00]">
                        👑 Premium
                      </span>
                    )}
                    {tag}
                    {o.is_female && (
                      <Tag color={ROSE} soft="rgba(236,72,153,.13)">
                        {t("tagFemale")}
                      </Tag>
                    )}
                  </span>
                  {o.vehicle && (
                    <span className="mt-0.5 block truncate text-[11px] text-[#6B7280]">
                      {o.vehicle}
                    </span>
                  )}
                  <span className="block truncate text-[11px] text-[#6B7280]">
                    {o.eta_min != null
                      ? t("etaLine", {
                          min: o.eta_min,
                          km: String(o.eta_km?.toFixed(1) ?? "?").replace(
                            ".",
                            ","
                          ),
                          rides: o.rides_count,
                        })
                      : t("ridesCount", { rides: o.rides_count })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="drive-sora block text-[17px] font-extrabold">
                    {o.price_da} DA
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void choose(o.id)}
                    className="mt-1 rounded-[11px] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: VIOLET }}
                  >
                    {t("choose")}
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <GhostBtn onClick={() => setCancelOpen(true)}>
          {t("cancelSearch")}
        </GhostBtn>
      </div>

      <CancelModal
        open={cancelOpen}
        ctx="client_search"
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          if (rideId) await cancelDriveRide(rideId, reason);
          else localStorage.removeItem("coligo_drive_pending_request");
          onCancelled(reason);
        }}
      />
      {/* Retour arrière vers l'écran prix tant qu'aucune offre */}
      {!ride && !offlineQueued && (
        <button
          type="button"
          onClick={onBackToPrice}
          className="absolute top-3 left-4 z-20 grid size-[42px] place-items-center rounded-[14px] border border-[#EEF0F4] bg-white shadow-lg"
        >
          <X className="size-5" />
        </button>
      )}
    </div>
  );
}

function Tag({
  children,
  color,
  soft,
}: {
  children: React.ReactNode;
  color: string;
  soft: string;
}) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
      style={{ background: soft, color }}
    >
      {children}
    </span>
  );
}

/* ════════════════ SUIVI DE COURSE (fiche chauffeur v3) ════════════════ */

function EnrouteScreen({
  ctx,
  ride,
  onCancelled,
}: {
  ctx: DriveContext;
  ride: DriveActiveRide;
  onCancelled: (reason: string) => void;
}) {
  const t = useTranslations("drive.enroute");
  const tc = useTranslations("drive");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);

  const ch = ride.chauffeur;
  const chPos =
    ch?.lat != null && ch?.lng != null ? { lat: ch.lat, lng: ch.lng } : null;
  const pickupPos =
    ride.pickup_lat != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng! }
      : null;
  const destPos =
    ride.dest_lat != null ? { lat: ride.dest_lat, lng: ride.dest_lng! } : null;
  const inProgress = ride.status === "in_progress";

  const etaApproachMin =
    chPos && pickupPos
      ? Math.max(1, Math.round(haversineKm(chPos, pickupPos) * 2.2))
      : null;
  const etaRideMin =
    chPos && destPos
      ? Math.max(1, Math.round(haversineKm(chPos, destPos) * 2.2))
      : null;

  const pill = inProgress
    ? t("pillInProgress", { min: etaRideMin ?? "…" })
    : ride.status === "arrived"
      ? t("pillArrived", { name: ch?.name ?? "" })
      : t("pillArriving", { name: ch?.name ?? "", min: etaApproachMin ?? "…" });

  /* Détection d'itinéraire anormal (écart fort vs route prévue). */
  const [devAlert, setDevAlert] = useState(false);
  const devSince = useRef<number | null>(null);
  const devMuteUntil = useRef(0);
  useEffect(() => {
    if (!inProgress || !chPos || !pickupPos || !destPos) return;
    const corridor =
      haversineKm(pickupPos, chPos) +
      haversineKm(chPos, destPos) -
      haversineKm(pickupPos, destPos);
    const now = Date.now();
    if (corridor > ctx.deviationKm) {
      if (devSince.current == null) devSince.current = now;
      if (
        now - devSince.current > ctx.deviationMin * 60_000 &&
        now > devMuteUntil.current
      )
        setDevAlert(true);
    } else {
      devSince.current = null;
      setDevAlert(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch?.lat, ch?.lng, inProgress]);

  const shareUrl = ride.share_token
    ? `${typeof window !== "undefined" ? window.location.origin : "https://coligo.app"}/t/${ride.share_token}`
    : null;
  const prepaid = ride.payment_method !== "cash";

  return (
    <div className="drive-jakarta fixed inset-0 z-40 bg-[#E9EBF1]">
      <DriveMap
        markers={[
          ...(chPos ? [{ id: "car", pos: chPos, kind: "car" as const }] : []),
          ...(pickupPos && !inProgress
            ? [{ id: "me", pos: pickupPos, kind: "me" as const }]
            : []),
          ...(destPos
            ? [{ id: "dest", pos: destPos, kind: "pin" as const }]
            : []),
        ]}
        approach={!inProgress && chPos && pickupPos ? [chPos, pickupPos] : null}
        route={
          inProgress && chPos && destPos
            ? [chPos, destPos]
            : pickupPos && destPos
              ? [pickupPos, destPos]
              : null
        }
        padding={{ top: 90, bottom: 440, left: 60, right: 60 }}
      />
      {/* Pill statut */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-[13.5px] font-bold whitespace-nowrap shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: inProgress ? GO : VIOLET }}
        />
        <span className="drive-sora">{pill}</span>
      </div>

      {/* Itinéraire anormal : « Tout va bien ? » */}
      {devAlert && (
        <div className="drive-up absolute top-16 right-2.5 left-2.5 z-30 rounded-[20px] border-2 border-[#F59E0B] bg-white p-3.5 shadow-[0_18px_44px_-14px_rgba(245,158,11,.45)]">
          <div className="flex items-start gap-2.5">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-[rgba(245,158,11,.15)]">
              <AlertTriangle className="size-5 text-[#F59E0B]" />
            </span>
            <span>
              <b className="block text-sm">{t("devTitle")}</b>
              <span className="text-[11.5px] leading-snug text-[#6B7280]">
                {t("devSub")}
              </span>
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              className="drive-sora h-[42px] flex-1 rounded-[12px] bg-[#F4F5F9] text-[13px] font-bold"
              onClick={() => {
                setDevAlert(false);
                devSince.current = null;
                devMuteUntil.current = Date.now() + 5 * 60_000;
              }}
            >
              {t("devOk")}
            </button>
            <button
              type="button"
              className="drive-sora h-[42px] flex-1 rounded-[12px] text-[13px] font-bold text-white"
              style={{ background: RED }}
              onClick={() => {
                setDevAlert(false);
                setSosOpen(true);
              }}
            >
              SOS
            </button>
          </div>
        </div>
      )}

      {/* Feuille bas : fiche chauffeur v3 */}
      <div className="absolute inset-x-0 bottom-0 z-10 max-h-[62vh] overflow-y-auto rounded-t-[28px] border-t border-[#EEF0F4] bg-white px-5 pt-3.5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[#EEF0F4]" />

        {ride.proxy_name && (
          <div
            className="mb-2.5 flex items-center gap-2 rounded-[13px] px-3 py-2.5 text-[12.5px] font-bold"
            style={{ background: "rgba(236,72,153,.13)", color: ROSE }}
          >
            <BadgeCheck className="size-4 shrink-0" />
            {t("proxBadge", { name: ride.proxy_name })}
          </div>
        )}

        {ch && (
          <div className="mb-3 rounded-[22px] border border-[#EEF0F4] bg-white p-4 shadow-[0_14px_34px_-12px_rgba(20,22,40,.26)]">
            <div className="flex items-center gap-3">
              <span
                className="drive-sora grid size-[58px] shrink-0 place-items-center rounded-full text-[22px] font-extrabold text-white"
                style={{
                  background: ch.is_female
                    ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                    : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {ch.name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="drive-sora flex items-center gap-1.5 text-[17px] font-extrabold">
                  {ch.name}
                  <BadgeCheck
                    className="size-4 shrink-0"
                    style={{ color: VIOLET }}
                  />
                  {ch.is_premium && (
                    <span className="rounded-full bg-[#E8B53C] px-2 py-0.5 text-[10px] font-extrabold text-[#3a2c00]">
                      👑
                    </span>
                  )}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {ch.rating != null && (
                    <span className="rounded-full bg-[rgba(245,158,11,.16)] px-2.5 py-1 text-[11px] font-bold text-[#B45309]">
                      ★ {String(ch.rating).replace(".", ",")}
                    </span>
                  )}
                  <span className="rounded-full bg-[#F4F5F9] px-2.5 py-1 text-[11px] font-bold text-[#6B7280]">
                    {t("ridesChip", { rides: ch.rides })}
                  </span>
                  {ch.is_female && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{
                        background: "rgba(236,72,153,.13)",
                        color: ROSE,
                      }}
                    >
                      {tc("search.tagFemale")}
                    </span>
                  )}
                </span>
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2.5 rounded-[13px] bg-[#F4F5F9] px-3 py-2.5">
              <span className="truncate text-[12.5px] font-bold">
                {ch.vehicle ?? "—"}
              </span>
              {ch.plate && (
                <span className="drive-sora shrink-0 rounded-[7px] border-2 border-[#0B0C12] bg-white px-2.5 py-1 text-[12.5px] font-extrabold tracking-[2px] text-[#0B0C12]">
                  {ch.plate}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#F4F5F9] text-[13.5px] font-bold"
              >
                <MessageSquare className="size-4" /> {t("message")}
              </button>
              <a
                href={ch.phone ? `tel:${ch.phone}` : undefined}
                className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-bold text-white"
                style={{ background: VIOLET }}
              >
                <Phone className="size-4" /> {t("call")}
              </a>
            </div>
          </div>
        )}

        {/* Prix convenu */}
        <div
          className="mb-2.5 flex items-center justify-between rounded-[14px] px-4 py-3"
          style={{ background: "#EEEEFD" }}
        >
          <span className="text-xs font-bold" style={{ color: VIOLET }}>
            {t("agreedPrice")}
          </span>
          <span
            className="drive-sora text-[17px] font-extrabold"
            style={{ color: VIOLET }}
          >
            {formatDA(ride.agreed_price_da ?? ride.proposed_price_da)}
          </span>
        </div>

        {/* Prépayée : code de fin + paiement carte */}
        {prepaid && (
          <div
            className="mb-2.5 rounded-[13px] px-3 py-2.5 text-[12.5px] leading-relaxed font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {ride.payment_method === "card" && !ride.online_paid ? (
              <>
                {t("cardToPay")}
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={async () => {
                    setCardBusy(true);
                    setCardErr(null);
                    const res = await createRideCardCheckout(ride.id);
                    setCardBusy(false);
                    if (res.ok && res.url) window.open(res.url, "_blank");
                    else setCardErr(res.error ?? "error");
                  }}
                  className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2 text-xs font-bold text-white"
                  style={{ background: GO }}
                >
                  {cardBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-4" />
                  )}
                  {t("cardPayNow")}
                </button>
                {cardErr && (
                  <span
                    className="mt-1 block text-[11px]"
                    style={{ color: RED }}
                  >
                    {cardErr}
                  </span>
                )}
              </>
            ) : (
              <>
                🔒 {t("prepaid")}{" "}
                {ride.end_code && (
                  <>
                    {t("endCode")}{" "}
                    <b className="tracking-[3px]">
                      {ride.end_code.split("").join(" ")}
                    </b>{" "}
                    — {t("endCodeGive")}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Sécurité : partager + SOS */}
        <div className="mb-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => shareUrl && setShareOpen(true)}
            className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[#EEF0F4] bg-white text-[12.5px] font-bold"
          >
            <Share2 className="size-4" /> {t("shareTrip")}
          </button>
          <button
            type="button"
            onClick={() => setSosOpen(true)}
            className="flex h-[46px] w-[86px] items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] text-[12.5px] font-bold"
            style={{ borderColor: RED, color: RED }}
          >
            <AlertTriangle className="size-4" /> SOS
          </button>
        </div>

        {!inProgress && (
          <GhostBtn danger onClick={() => setCancelOpen(true)}>
            {t("cancelRide")}
          </GhostBtn>
        )}
      </div>

      <CancelModal
        open={cancelOpen}
        ctx="client_enroute"
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          await cancelDriveRide(ride.id, reason);
          onCancelled(reason);
        }}
      />
      {shareUrl && ch && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          shareUrl={shareUrl}
          chName={ch.name}
          chRating={
            ch.rating != null ? String(ch.rating).replace(".", ",") : null
          }
          chCar={ch.vehicle}
          chPlate={ch.plate}
        />
      )}
      <SOSModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        rideId={ride.id}
        side="client"
        shareUrl={shareUrl}
        position={pickupPos}
      />
      <ChatModal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        rideId={ride.id}
        side="customer"
      />
    </div>
  );
}

/* ════════════════ FIN DE COURSE ════════════════ */

function DoneScreen({
  ride,
  onExit,
}: {
  ride: NonNullable<DriveLastRide>;
  onExit: () => void;
}) {
  const t = useTranslations("drive.done");
  const [rating, setRating] = useState(ride.my_rating ?? 0);
  const [fav, setFav] = useState(ride.chauffeur?.is_favorite ?? false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);

  const payLabel =
    ride.payment_method === "cash"
      ? t("payCash")
      : ride.payment_method === "card"
        ? t("payCard")
        : t("payCpay");
  const commissionPct =
    ride.commission_rate != null
      ? `${String(Math.round(ride.commission_rate * 1000) / 10).replace(".", ",")} %`
      : null;

  return (
    <div className="drive-jakarta fixed inset-0 z-40 overflow-y-auto bg-white px-5 pt-6 pb-8">
      <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
        {t("title")}
      </h1>
      <p className="mb-4 text-[13px] text-[#6B7280]">
        {ride.pickup_text ?? "—"} → {ride.dest_text ?? "—"}
      </p>

      {ride.chauffeur && (
        <div className="mb-3 flex items-center gap-3 rounded-[15px] bg-[#F4F5F9] px-3 py-2.5">
          <span
            className="drive-sora grid size-10 shrink-0 place-items-center rounded-full font-extrabold text-white"
            style={{ background: `linear-gradient(135deg,#7B7BF0,${VIOLET})` }}
          >
            {ride.chauffeur.name[0]?.toUpperCase()}
          </span>
          <span>
            <b className="block text-[13.5px]">{ride.chauffeur.name}</b>
            <span className="text-[10.5px] text-[#6B7280]">
              {t("maskedAfter")}
            </span>
          </span>
        </div>
      )}

      <div className="mb-3 rounded-[18px] border border-[#EEF0F4] p-4">
        <Row k={t("agreed")} v={formatDA(ride.price_da)} />
        {commissionPct && (
          <Row
            k={t("commission", { pct: commissionPct })}
            v={t("included")}
            muted
          />
        )}
        <div className="mt-1 flex items-center justify-between border-t border-[#EEF0F4] pt-3 text-sm font-bold">
          <span className="text-[#6B7280]">{payLabel}</span>
          <span className="drive-sora text-lg">{formatDA(ride.price_da)}</span>
        </div>
      </div>

      {ride.cashback_da > 0 && (
        <div
          className="mb-3 flex items-center gap-3 rounded-[16px] p-3"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white">
            <Gift className="size-5" style={{ color: GO }} />
          </span>
          <span>
            <b className="block text-[13.5px]" style={{ color: GO }}>
              {t("cashback", { amount: ride.cashback_da })}
            </b>
            <span className="text-[11px] text-[#6B7280]">
              {t("cashbackSub")}
            </span>
          </span>
        </div>
      )}

      <p className="mb-1 text-center text-sm font-semibold">{t("rateTitle")}</p>
      <div className="mb-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={async () => {
              setRating(n);
              await rateDriveRide(ride.id, n);
            }}
          >
            <Star
              className="size-8"
              style={{
                color: "#E8B53C",
                fill: n <= rating ? "#E8B53C" : "transparent",
              }}
            />
          </button>
        ))}
      </div>

      {ride.chauffeur && (
        <button
          type="button"
          onClick={async () => {
            const next = !fav;
            setFav(next);
            await toggleFavoriteChauffeur(ride.chauffeur!.id, next);
          }}
          className="mb-2.5 h-[46px] w-full rounded-[14px] border-[1.5px] text-[13px] font-bold"
          style={
            fav
              ? {
                  borderColor: ROSE,
                  color: ROSE,
                  background: "rgba(236,72,153,.13)",
                }
              : { borderColor: "#EEF0F4" }
          }
        >
          {fav
            ? t("favOn", { name: ride.chauffeur.name })
            : t("favOff", { name: ride.chauffeur.name })}
        </button>
      )}

      {reported ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          {t("reportOk", { reason: reported })}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="mb-2 block w-full text-center text-[12.5px] font-bold"
          style={{ color: RED }}
        >
          {t("reportBtn")}
        </button>
      )}

      <PrimaryBtn onClick={onExit}>{t("finish")}</PrimaryBtn>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        side="client"
        onConfirm={async (reason) => {
          setReportOpen(false);
          await reportDriveRide(ride.id, reason);
          setReported(reason);
        }}
      />
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 text-[13.5px]">
      <span className="text-[#6B7280]">{k}</span>
      <span className={cn(muted && "text-[#6B7280]")}>{v}</span>
    </div>
  );
}

/* ════════════════ COURSE ANNULÉE ════════════════ */

function CancelledScreen({
  reason,
  mine,
  onExit,
}: {
  reason: string | null;
  mine: boolean;
  onExit: () => void;
}) {
  const t = useTranslations("drive.cancelledScreen");
  return (
    <div className="drive-jakarta fixed inset-0 z-40 bg-white px-5 pt-12">
      <div className="flex flex-col items-center text-center">
        <span
          className="mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.1)" }}
        >
          <X className="size-7" style={{ color: RED }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">{t("title")}</h1>
        <p className="mt-1 max-w-[280px] text-[13px] text-[#6B7280]">
          {mine ? t("byYou") : t("byOther")}
        </p>
      </div>
      {reason && (
        <div className="mt-4 rounded-[18px] border border-[#EEF0F4] p-4">
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[#6B7280]">{t("reason")}</span>
            <span className="font-semibold">{reason}</span>
          </div>
        </div>
      )}
      <PrimaryBtn onClick={onExit} className="mt-5">
        {t("back")}
      </PrimaryBtn>
    </div>
  );
}
