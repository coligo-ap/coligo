"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";
import { cn, formatDA } from "@/lib/utils";
import { haversineKm } from "@/lib/delivery/distance";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { DriveMap } from "./drive-map";
import { ChAvatar } from "./ch-avatar";
import { DriverBadgePill } from "@/components/drive/driver-badge";
import { getDriverBadge } from "@/lib/drive/driver-badge";
import {
  CancelModal,
  ChatModal,
  GhostBtn,
  PrimaryBtn,
  ReportModal,
  ShareModal,
  SosContactsSheet,
  SOSModal,
  GO,
  ROSE,
  RED,
  VIOLET,
  type SosContact,
} from "./drive-modals";
import {
  acceptDriveOffer,
  boostRide,
  cancelDriveRide,
  createRideCardCheckout,
  escalateDispatch,
  getDriveLastRide,
  getDriveOffers,
  getRideCardState,
  getRideMessages,
  markRideMessagesRead,
  rateDriveRide,
  getSosContacts,
  reportDriveRide,
  setSosContacts as saveSosContacts,
  toggleFavoriteChauffeur,
  type DriveActiveRide,
  type DriveContext,
  type DriveLastRide,
  type DriveOffer,
} from "@/app/(customer)/drive/actions";
import { clearPendingRide } from "@/lib/drive/offline-db";
import { useUnreadRideMessages } from "@/lib/drive/use-unread-messages";
import { useRideCall } from "@/lib/call/use-ride-call";
import { RidePhoneShareToggle } from "@/components/customer/drive/ride-phone-share-toggle";

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
  onCardFailed,
}: {
  ctx: DriveContext;
  active: DriveActiveRide | null;
  offlineQueued: boolean;
  refreshActive: () => Promise<DriveActiveRide | null>;
  onExit: () => void;
  onBackToPrice: () => void;
  /** Paiement carte échoué (webhook) : retour au choix de gamme, message inline. */
  onCardFailed: () => void;
}) {
  const [done, setDone] = useState<DriveLastRide>(null);
  const [cancelled, setCancelled] = useState<{
    reason: string | null;
    mine: boolean;
    refunded: boolean;
  } | null>(null);
  const lastStatus = useRef<string | null>(active?.status ?? null);
  // Carte en attente de paiement : id de la course à surveiller (échec
  // Chargily → le webhook annule la demande, on revient au choix de gamme).
  const waitingCardRef = useRef<string | null>(null);
  if (active) {
    // Conservée quand `active` devient null : l'annulation webhook fait
    // disparaître la course AVANT que l'échec carte soit détecté ici.
    waitingCardRef.current =
      active.payment_method === "card" && !active.online_paid
        ? active.id
        : null;
  }

  // RETOUR D'ARRIÈRE-PLAN : à la reprise (déverrouillage, retour d'une autre app,
  // onglet réactivé, réseau revenu), on bumpe ce compteur → les effets de
  // synchro/Realtime ci-dessous se relancent IMMÉDIATEMENT (poll + ré-abonnement
  // au Realtime, qui a pu tomber en arrière-plan). Ainsi, si un chauffeur a
  // accepté / la course a changé pendant l'absence, l'écran le reflète AUSSITÔT
  // au lieu d'attendre le prochain tick throttlé, et l'action suivante (annuler…)
  // part d'un état frais sur une connexion réveillée.
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // Poll de la course active + détection de transition (terminée / annulée).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      // Échec du paiement carte (webhook seul fait foi, mig 0163) : retour
      // direct à l'écran de choix de gamme — PAS l'écran « course annulée ».
      if (waitingCardRef.current) {
        const st = await getRideCardState(waitingCardRef.current);
        if (stop) return;
        if (st?.failed) {
          onCardFailed();
          return;
        }
      }
      const ride = await refreshActive();
      if (stop) return;
      if (!ride && lastStatus.current && !cancelled) {
        const last = await getDriveLastRide();
        if (stop) return;
        if (last?.status === "completed") setDone(last);
        else if (waitingCardRef.current) {
          // Disparue pendant l'attente carte = annulée pour échec de
          // paiement → choix de gamme, pas l'écran « course annulée ».
          onCardFailed();
          return;
        } else if (last)
          setCancelled({
            reason: null,
            mine: false,
            refunded: last.payment_method !== "cash",
          });
        lastStatus.current = null;
        return;
      }
      if (ride) lastStatus.current = ride.status;
    };
    // Poll = FILET LENT seulement : la sync course (statut/terminée/annulée) est
    // INSTANTANÉE via le Realtime ci-dessous (postgres_changes sur `rides`). On
    // ne martèle PAS le serveur — façon Uber/Google : push DB temps réel + poll
    // de rattrapage uniquement (avant : 4 s → 20 s). Cas spécial paiement carte
    // (webhook) : le filet 20 s suffit le temps de la confirmation.
    const id = setInterval(tick, 20000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
    // resyncNonce : un retour d'arrière-plan relance un tick immédiat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshActive, resyncNonce]);

  // Temps réel : tout changement de la course (acceptation, statut, prix
  // convenu) rafraîchit instantanément — le poll 4 s reste en filet.
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (!activeId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`ride-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rides",
          filter: `id=eq.${activeId}`,
        },
        () => void refreshActive()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // resyncNonce : ré-abonnement au retour d'arrière-plan (le canal a pu tomber).
  }, [activeId, refreshActive, resyncNonce]);

  if (done) return <DoneScreen ride={done} onExit={onExit} />;
  if (cancelled)
    return (
      <CancelledScreen
        reason={cancelled.reason}
        mine={cancelled.mine}
        refunded={cancelled.refunded}
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
        onBackToPrice={onBackToPrice}
      />
    );
  return (
    <EnrouteScreen
      ctx={ctx}
      ride={active}
      onCancelled={(reason) =>
        setCancelled({
          reason,
          mine: true,
          refunded: (active?.payment_method ?? "cash") !== "cash",
        })
      }
    />
  );
}

/* ════════════════ OFFRES DES CHAUFFEURS (triables) ════════════════ */

function SearchScreen({
  ctx,
  ride,
  offlineQueued,
  refreshActive,
  onBackToPrice,
}: {
  ctx: DriveContext;
  ride: DriveActiveRide | null;
  offlineQueued: boolean;
  refreshActive: () => Promise<DriveActiveRide | null>;
  onBackToPrice: () => void;
}) {
  const t = useTranslations("drive.search");
  const [offers, setOffers] = useState<DriveOffer[]>([]);
  const [sort, setSort] = useState<"best" | "cheap" | "rated">("best");
  const [busy, setBusy] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const rideId = ride?.id ?? null;
  // Carte : tant que le webhook n'a pas confirmé, la demande n'est pas diffusée.
  const waitingCard =
    !!ride && ride.payment_method === "card" && !ride.online_paid;

  const stopRef = useRef(false);
  // Retour d'arrière-plan : relance le poll des offres + le ré-abonnement Realtime
  // dès la reprise (cf. DriveRide / CLAUDE.md) → les offres reçues pendant
  // l'absence apparaissent tout de suite, pas au prochain tick throttlé.
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));
  // Re-dispatch escaladé : si AUCUNE offre après un délai, on demande au serveur
  // d'élargir le rayon (mig 0255). Délai de DÉPART côté client (≥20 s, laisse sa
  // chance au rayon initial) ; le serveur gère le RYTHME (25 s) et le PLAFOND.
  const searchStartRef = useRef(Date.now());
  const lastEscalateRef = useRef(0);
  const poll = useCallback(async () => {
    if (!rideId) return;
    const o = await getDriveOffers(rideId);
    if (stopRef.current) return;
    setOffers(o);
    // Personne n'a répondu et l'attente dépasse le seuil → escalade (best-effort,
    // throttlée client + serveur autoritaire). On n'escalade pas s'il y a déjà
    // des offres (le client a des options).
    if (o.length === 0) {
      const now = Date.now();
      if (
        now - searchStartRef.current > 20_000 &&
        now - lastEscalateRef.current > 25_000
      ) {
        lastEscalateRef.current = now;
        void escalateDispatch(rideId);
      }
    }
  }, [rideId]);

  useEffect(() => {
    if (!rideId) return;
    stopRef.current = false;
    void poll();
    // FILET LENT : chaque offre arrive INSTANTANÉMENT via le Realtime sur
    // `ride_offers` (ci-dessous). Poll de rattrapage seulement (avant : 4 s).
    const id = setInterval(() => void poll(), 15000);
    return () => {
      stopRef.current = true;
      clearInterval(id);
    };
    // resyncNonce : poll immédiat au retour d'arrière-plan.
  }, [rideId, poll, resyncNonce]);

  // Temps réel (mig 0149) : chaque offre / contre-offre / retrait d'un
  // chauffeur apparaît INSTANTANÉMENT — le poll lent n'est qu'un filet.
  useEffect(() => {
    if (!rideId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`ride-offers-${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_offers",
          filter: `ride_id=eq.${rideId}`,
        },
        () => void poll()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // resyncNonce : ré-abonnement au retour d'arrière-plan (le canal a pu tomber).
  }, [rideId, poll, resyncNonce]);

  const sorted = useMemo(() => {
    const list = [...offers];
    if (sort === "best")
      // Classement intelligent : note, satisfaction, fiabilité, ponctualité,
      // expérience, ancienneté, proximité + coef Premium (mig 0149).
      list.sort(
        (a, b) => b.rank_score - a.rank_score || a.price_da - b.price_da
      );
    else if (sort === "cheap")
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
  const maxScore = Math.max(...offers.map((o) => o.rank_score));
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
    try {
      const res = await acceptDriveOffer(offerId, `acc-${offerId}`);
      if (!res.ok)
        setError(
          res.error === "chauffeur_busy" ? t("driverBusy") : (res.error ?? null)
        );
      await refreshActive();
    } catch {
      // Exception réseau : on RELÂCHE toujours `busy` (finally). Sinon il reste
      // bloqué à true → « Annuler la recherche » (if (busy) return) et le choix
      // d'offre deviennent inopérants jusqu'à un rechargement de page.
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  };

  // NB : plus d'ajout aux favoris ici — un chauffeur ne peut devenir favori
  // qu'APRÈS une course terminée avec lui (écran de fin, RLS mig 0149).

  return (
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-page)]">
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
      <div className="absolute inset-x-0 top-[230px] bottom-0 z-10 overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-8 shadow-[0_-16px_40px_-22px_rgba(20,22,40,.3)]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />

        {/* Statut de recherche */}
        <div
          className="mb-2.5 flex items-center gap-2 text-[13px] font-bold"
          style={{ color: VIOLET }}
        >
          {!offlineQueued && (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-[var(--d-accent)]"
              style={{ borderTopColor: VIOLET }}
            />
          )}
          {offlineQueued
            ? t("offlineTitle")
            : waitingCard
              ? t("waitingCard")
              : offers.length > 0
                ? t("responded", { count: offers.length })
                : t("incoming")}
        </div>

        {/* CARTE : payer AVANT diffusion — la demande ne part aux chauffeurs
            qu'une fois le paiement Chargily confirmé (webhook, mig 0145). */}
        {waitingCard && ride && (
          <div
            className="mb-3 rounded-[15px] border-[1.5px] border-dashed p-3"
            style={{ borderColor: GO }}
          >
            <b className="block text-[13px]" style={{ color: GO }}>
              {t("waitingCard")}
            </b>
            <span className="text-[11px] leading-snug text-[var(--d-muted)]">
              {t("waitingCardSub")}
            </span>
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
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2 text-xs font-bold text-white"
              style={{ background: GO }}
            >
              {cardBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              {t("payNow")}
            </button>
            {cardErr && (
              <span className="mt-1 block text-[11px]" style={{ color: RED }}>
                {cardErr}
              </span>
            )}
          </div>
        )}

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
          <div className="mb-3 flex items-start gap-2.5 rounded-[15px] border-[1.5px] border-dashed border-[#6B7280] bg-[var(--d-soft)] p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
              <WifiOff className="size-4.5 text-[var(--d-muted)]" />
            </span>
            <span>
              <b className="block text-[13px]">{t("offlineTitle")}</b>
              <span className="text-[11px] leading-snug text-[var(--d-muted)]">
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
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-surface)]">
              <Zap className="size-4" style={{ color: GO }} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[12.5px]" style={{ color: GO }}>
                {t("boostBar", { amount: boostDefault })}
              </b>
              <span className="text-[10.5px] text-[var(--d-muted)]">
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
              ["best", t("sortBest")],
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
                      background: "var(--d-accent)",
                      color: VIOLET,
                    }
                  : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
              }
            >
              <ArrowDownUp className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Repli conductrices */}
        {femaleFallback && (
          <div className="mb-2.5 flex items-start gap-2.5 rounded-[13px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold text-[var(--d-muted)]">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              style={{ color: ROSE }}
            />
            <span>
              <b className="text-[var(--d-ink)]">{t("femaleFallbackTitle")}</b>{" "}
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
            const tone = female
              ? o.is_female
                ? ROSE
                : "var(--d-ink)"
              : undefined;
            let tag: React.ReactNode = null;
            if (o.is_favorite)
              tag = (
                <Tag color={VIOLET} soft="var(--d-accent)">
                  ♥ {t("tagFav")}
                </Tag>
              );
            else if (sort === "best" && o.rank_score === maxScore)
              tag = (
                <Tag color={GO} soft="rgba(22,179,100,.12)">
                  {t("tagTop")}
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
                className="drive-rise mb-2 flex items-center gap-3 rounded-[18px] border bg-[var(--d-soft)] p-3"
                style={{
                  borderColor: female
                    ? o.is_female
                      ? ROSE
                      : "var(--d-ink)"
                    : "var(--d-line)",
                }}
              >
                <ChAvatar
                  name={o.name}
                  url={o.avatar_url}
                  size={44}
                  textClassName="text-base"
                  ringColor={o.badge_color}
                  background={
                    tone === "var(--d-ink)"
                      ? "var(--d-ink)"
                      : tone === ROSE
                        ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                        : `linear-gradient(135deg,#7B7BF0,${VIOLET})`
                  }
                />
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
                    {o.is_priority && (
                      <span className="rounded-full bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-2 py-0.5 text-[9.5px] font-extrabold text-white">
                        ⚡ Prioritaire
                      </span>
                    )}
                    <DriverBadgePill
                      badge={getDriverBadge({
                        ridesCount: o.rides_count,
                        rating: o.rating,
                      })}
                    />
                    {tag}
                    {o.is_female && (
                      <Tag color={ROSE} soft="rgba(236,72,153,.13)">
                        {t("tagFemale")}
                      </Tag>
                    )}
                  </span>
                  {o.vehicle && (
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--d-muted)]">
                      {o.vehicle}
                    </span>
                  )}
                  <span className="block truncate text-[11px] text-[var(--d-muted)]">
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

        {/* Annulation AVANT choix du chauffeur : directe, sans motif demandé,
            retour immédiat à l'écran prix (séquestre recrédité côté serveur).
            La course n'apparaît pas dans l'historique (jamais attribuée). */}
        <GhostBtn
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              if (rideId) await cancelDriveRide(rideId, null);
              else await clearPendingRide();
              onBackToPrice();
            } catch {
              // Échec d'annulation (réseau / action) : on relâche TOUJOURS `busy`
              // via finally → le bouton « Annuler » reste cliquable et réessayable
              // immédiatement, plus besoin d'actualiser la page.
              setError(t("genericError"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("cancelSearch")}
        </GhostBtn>
      </div>
      {/* Retour arrière vers l'écran prix tant qu'aucune offre */}
      {!ride && !offlineQueued && (
        <button
          type="button"
          onClick={onBackToPrice}
          className="absolute top-3 left-4 z-20 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
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

/**
 * Tracé routier réel (OSRM) entre deux points mobiles, throttlé : on ne
 * re-demande l'itinéraire que si le départ a bougé de > 150 m (la voiture
 * avance) ou l'arrivée de > 50 m — sinon on garde le tracé en l'état.
 * Fallback : l'appelant affiche la ligne droite tant que path est null.
 */
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
  // Appel in-app (audio + cam optionnelle) avec le chauffeur — numéro masqué.
  const call = useRideCall({
    rideId: ride.id,
    role: "client",
    peerName: ride.chauffeur?.name ?? "Chauffeur",
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Contacts d'urgence enregistrés (appel rapide, alerte, partage).
  const [sosContacts, setSosContacts] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [midReportOpen, setMidReportOpen] = useState(false);
  const [midReported, setMidReported] = useState(false);
  useEffect(() => {
    void getSosContacts().then(setSosContacts);
  }, []);

  // Messages non lus du chauffeur (compteur + notification in-app + « reçu »).
  const { unread, lastIncoming, markSeen } = useUnreadRideMessages(
    ride.id,
    "chauffeur",
    getRideMessages,
    true,
    markRideMessagesRead
  );
  const [msgBanner, setMsgBanner] = useState<string | null>(null);
  const lastMsgId = lastIncoming?.id ?? null;
  const lastMsgBody = lastIncoming?.body ?? null;
  const notifiedRef = useRef<string | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    // 1re salve chargée : mémoriser sans notifier les messages déjà présents.
    if (!seededRef.current && lastMsgId !== null) {
      seededRef.current = true;
      notifiedRef.current = lastMsgId;
      return;
    }
    if (chatOpen) return;
    if (lastMsgId && lastMsgId !== notifiedRef.current) {
      notifiedRef.current = lastMsgId;
      setMsgBanner(lastMsgBody);
      const id = setTimeout(() => setMsgBanner(null), 6000);
      return () => clearTimeout(id);
    }
  }, [lastMsgId, lastMsgBody, chatOpen]);
  useEffect(() => {
    if (chatOpen) {
      markSeen();
      setMsgBanner(null);
      void markRideMessagesRead(ride.id, true);
    }
  }, [chatOpen, markSeen, ride.id]);

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

  // Tracés routiers réels (suivent les rues, throttlés) : approche voiture →
  // client tant que la course n'a pas démarré, course (position courante ou
  // départ) → destination. Ligne droite en attendant la 1re réponse.
  const rideFrom = inProgress ? chPos : pickupPos;
  const approachPath = useRoadPath(
    !inProgress ? chPos : null,
    !inProgress ? pickupPos : null
  );
  const ridePath = useRoadPath(rideFrom, destPos);

  return (
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-page)]">
      <DriveMap
        markers={[
          ...(chPos ? [{ id: "car", pos: chPos, kind: "car" as const }] : []),
          ...(pickupPos
            ? [
                {
                  id: "me",
                  pos: pickupPos,
                  kind: "pin" as const,
                  label: "A" as const,
                },
              ]
            : []),
          ...(destPos
            ? [
                {
                  id: "dest",
                  pos: destPos,
                  kind: "pin" as const,
                  label: "B" as const,
                },
              ]
            : []),
        ]}
        approach={
          !inProgress && chPos && pickupPos
            ? (approachPath ?? [chPos, pickupPos])
            : null
        }
        route={rideFrom && destPos ? (ridePath ?? [rideFrom, destPos]) : null}
        padding={{ top: 90, bottom: 440, left: 60, right: 60 }}
      />
      {/* Pill statut */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold whitespace-nowrap shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: inProgress ? GO : VIOLET }}
        />
        <span className="drive-sora">{pill}</span>
      </div>

      {/* Notification in-app : nouveau message du chauffeur (chat fermé). */}
      {msgBanner && (
        <button
          type="button"
          onClick={() => {
            setChatOpen(true);
            setMsgBanner(null);
          }}
          className="drive-up absolute top-16 right-2.5 left-2.5 z-40 flex items-center gap-2.5 rounded-[16px] border-2 bg-[var(--d-surface)] px-3.5 py-3 text-left shadow-xl"
          style={{ borderColor: VIOLET }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--d-accent)" }}
          >
            <MessageSquare className="size-4" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13px]">{t("message")}</b>
            <span className="block truncate text-[12px] text-[var(--d-muted)]">
              {msgBanner}
            </span>
          </span>
          <span
            className="shrink-0 text-[11px] font-extrabold"
            style={{ color: VIOLET }}
          >
            Voir
          </span>
        </button>
      )}

      {/* Itinéraire anormal : « Tout va bien ? » */}
      {devAlert && (
        <div className="drive-up absolute top-16 right-2.5 left-2.5 z-30 rounded-[20px] border-2 border-[#F59E0B] bg-[var(--d-surface)] p-3.5 shadow-[0_18px_44px_-14px_rgba(245,158,11,.45)]">
          <div className="flex items-start gap-2.5">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-[rgba(245,158,11,.15)]">
              <AlertTriangle className="size-5 text-[#F59E0B]" />
            </span>
            <span>
              <b className="block text-sm">{t("devTitle")}</b>
              <span className="text-[11.5px] leading-snug text-[var(--d-muted)]">
                {t("devSub")}
              </span>
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              className="drive-sora h-[42px] flex-1 rounded-[12px] bg-[var(--d-soft)] text-[13px] font-bold"
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
          <div className="mt-1.5 flex justify-center gap-4 text-[11.5px] font-bold">
            <button
              type="button"
              style={{ color: RED }}
              onClick={() => {
                setDevAlert(false);
                setMidReportOpen(true);
              }}
            >
              {t("devReport")}
            </button>
            <button
              type="button"
              style={{ color: VIOLET }}
              onClick={() => {
                setDevAlert(false);
                setSosOpen(true);
              }}
            >
              {t("devSupport")}
            </button>
          </div>
        </div>
      )}

      {/* Feuille bas : fiche chauffeur v3 */}
      <div className="absolute inset-x-0 bottom-0 z-10 max-h-[62vh] overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />

        {ride.proxy_name && (
          <div
            className="mb-2.5 rounded-[13px] px-3 py-2.5 text-[12.5px] font-bold"
            style={{ background: "rgba(236,72,153,.13)", color: ROSE }}
          >
            <span className="flex items-center gap-2">
              <BadgeCheck className="size-4 shrink-0" />
              {t("proxBadge", { name: ride.proxy_name })}
            </span>
            {/* Envoi du lien de suivi au proche (sans compte) — checklist B9 */}
            {shareUrl && ride.proxy_phone && (
              <span className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  className="flex-1 rounded-[9px] px-2 py-1.5 text-[11px] font-bold text-white"
                  style={{ background: GO }}
                  onClick={() =>
                    window.open(
                      `https://wa.me/${ride.proxy_phone!.replace(/\D/g, "")}?text=${encodeURIComponent(
                        tc("share.message", {
                          name: ch?.name ?? "—",
                          url: shareUrl,
                        })
                      )}`,
                      "_blank"
                    )
                  }
                >
                  {t("proxSendWa")}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-[9px] bg-[var(--d-surface)] px-2 py-1.5 text-[11px] font-bold"
                  style={{ color: ROSE }}
                  onClick={() =>
                    window.open(
                      `sms:${ride.proxy_phone}?body=${encodeURIComponent(
                        tc("share.message", {
                          name: ch?.name ?? "—",
                          url: shareUrl,
                        })
                      )}`,
                      "_self"
                    )
                  }
                >
                  {t("proxSendSms")}
                </button>
              </span>
            )}
          </div>
        )}

        {ch && (
          <div className="mb-3 rounded-[22px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_14px_34px_-12px_rgba(20,22,40,.26)]">
            <div className="flex items-center gap-3">
              <ChAvatar
                name={ch.name}
                url={ch.avatar_url}
                size={58}
                female={ch.is_female}
                textClassName="text-[22px]"
              />
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
                  <span className="rounded-full bg-[var(--d-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--d-muted)]">
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
            <div className="mt-3 flex items-center justify-between gap-2.5 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5">
              <span className="truncate text-[12.5px] font-bold">
                {ch.vehicle ?? "—"}
              </span>
              {ch.plate && (
                <span className="drive-sora drive-plate shrink-0 rounded-[7px] border-2 px-2.5 py-1 text-[12.5px] font-extrabold tracking-[2px] text-[var(--d-ink)]">
                  {ch.plate}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="relative flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-[var(--d-soft)] text-[13.5px] font-bold"
              >
                <MessageSquare className="size-4" /> {t("message")}
                {unread > 0 && (
                  <span
                    className="drive-badge absolute -top-1.5 -right-1.5 grid min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-extrabold text-white"
                    style={{ background: RED }}
                  >
                    {unread}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => call.start(false)}
                className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-bold text-white"
                style={{ background: VIOLET }}
              >
                <Phone className="size-4" /> {t("call")}
              </button>
            </div>
            {/* Toggle « Afficher mon numéro au chauffeur » (gating serveur). */}
            <RidePhoneShareToggle rideId={ride.id} />
          </div>
        )}

        {/* Prix convenu */}
        <div
          className="mb-2.5 flex items-center justify-between rounded-[14px] px-4 py-3"
          style={{ background: "var(--d-accent)" }}
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

        {/* Prépayée (séquestre) : CODE PIN à communiquer à l'ARRIVÉE du
            chauffeur — sa saisie DÉMARRE la course ; l'argent reste bloqué
            et n'est libéré au chauffeur qu'à la fin (mig 0145). */}
        {prepaid && (
          <div
            className="mb-2.5 rounded-[13px] px-3 py-2.5 text-[12.5px] leading-relaxed font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {inProgress ? (
              <>🔒 {t("prepaidOnboard")}</>
            ) : (
              <>
                🔒 {t("prepaid")}{" "}
                {ride.end_code && (
                  <>
                    {t("pinLabel")}{" "}
                    <b className="text-[15px] tracking-[4px]">
                      {ride.end_code.split("").join(" ")}
                    </b>{" "}
                    — {t("pinGive")}
                  </>
                )}
                <span className="mt-1 block text-[11px] font-semibold text-[var(--d-muted)]">
                  {t("escrowNote")}
                </span>
              </>
            )}
            {/* Coligo Pay partiel : le complément se règle en espèces. */}
            {ride.payment_method === "coligo_pay" && ride.cash_due_da > 0 && (
              <span className="mt-1.5 block border-t border-[rgba(22,179,100,.25)] pt-1.5 text-[12px]">
                💵 {t("cashDue", { amount: ride.cash_due_da })}
              </span>
            )}
          </div>
        )}

        {midReported && (
          <p
            className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {t("devReported")}
          </p>
        )}

        {/* Sécurité : partager + SOS */}
        <div className="mb-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => shareUrl && setShareOpen(true)}
            className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-[12.5px] font-bold"
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
          emergencyContacts={sosContacts}
        />
      )}
      <SOSModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        rideId={ride.id}
        side="client"
        shareUrl={shareUrl}
        position={chPos ?? pickupPos}
        contacts={sosContacts}
        onManageContacts={() => {
          setSosOpen(false);
          setContactsOpen(true);
        }}
      />
      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await saveSosContacts(next);
          if (res.ok) setSosContacts(next);
          return res;
        }}
      />
      {/* Signalement EN COURS de course (alerte itinéraire anormal) */}
      <ReportModal
        open={midReportOpen}
        onClose={() => setMidReportOpen(false)}
        side="client"
        onConfirm={async (reason) => {
          setMidReportOpen(false);
          await reportDriveRide(ride.id, reason);
          setMidReported(true);
        }}
      />
      <ChatModal
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          markSeen();
        }}
        rideId={ride.id}
        side="customer"
      />

      {/* Appel in-app (sonnerie entrante/sortante + fenêtre d'appel Agora). */}
      {call.ui}
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

  // Coligo Pay partiel : séquestre + complément espèces (mig 0163).
  const mixed = ride.payment_method === "coligo_pay" && ride.cash_due_da > 0;
  const payLabel =
    ride.payment_method === "cash"
      ? t("payCash")
      : ride.payment_method === "card"
        ? t("payCard")
        : mixed
          ? t("payMixed")
          : t("payCpay");
  const commissionPct =
    ride.commission_rate != null
      ? `${String(Math.round(ride.commission_rate * 1000) / 10).replace(".", ",")} %`
      : null;

  return (
    <div className="drive-jakarta drive-screen z-40 overflow-y-auto bg-[var(--d-surface)] px-5 pt-6 pb-8">
      <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
        {t("title")}
      </h1>
      <p className="mb-4 text-[13px] text-[var(--d-muted)]">
        {ride.pickup_text ?? "—"} → {ride.dest_text ?? "—"}
      </p>

      {ride.chauffeur && (
        <div className="mb-3 flex items-center gap-3 rounded-[15px] bg-[var(--d-soft)] px-3 py-2.5">
          <ChAvatar
            name={ride.chauffeur.name}
            url={ride.chauffeur.avatar_url}
            size={40}
          />
          <span>
            <b className="block text-[13.5px]">{ride.chauffeur.name}</b>
            <span className="text-[10.5px] text-[var(--d-muted)]">
              {t("maskedAfter")}
            </span>
          </span>
        </div>
      )}

      <div className="mb-3 rounded-[18px] border border-[var(--d-line)] p-4">
        <Row k={t("agreed")} v={formatDA(ride.price_da)} />
        {commissionPct && (
          <Row
            k={t("commission", { pct: commissionPct })}
            v={t("included")}
            muted
          />
        )}
        <div className="mt-1 flex items-center justify-between border-t border-[var(--d-line)] pt-3 text-sm font-bold">
          <span className="text-[var(--d-muted)]">{payLabel}</span>
          <span className="drive-sora text-lg">{formatDA(ride.price_da)}</span>
        </div>
        {mixed && (
          <p className="mt-1 text-[11.5px] font-semibold text-[var(--d-muted)]">
            {t("payMixedDetail", {
              wallet: ride.price_da - ride.cash_due_da,
              cash: ride.cash_due_da,
            })}
          </p>
        )}
      </div>

      {ride.cashback_da > 0 && (
        <div
          className="mb-3 flex items-center gap-3 rounded-[16px] p-3"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
            <Gift className="size-5" style={{ color: GO }} />
          </span>
          <span>
            <b className="block text-[13.5px]" style={{ color: GO }}>
              {t("cashback", { amount: ride.cashback_da })}
            </b>
            <span className="text-[11px] text-[var(--d-muted)]">
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
              : { borderColor: "var(--d-line)" }
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
      <span className="text-[var(--d-muted)]">{k}</span>
      <span className={cn(muted && "text-[var(--d-muted)]")}>{v}</span>
    </div>
  );
}

/* ════════════════ COURSE ANNULÉE ════════════════ */

function CancelledScreen({
  reason,
  mine,
  refunded,
  onExit,
}: {
  reason: string | null;
  mine: boolean;
  refunded?: boolean;
  onExit: () => void;
}) {
  const t = useTranslations("drive.cancelledScreen");
  return (
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-surface)] px-5 pt-12">
      <div className="flex flex-col items-center text-center">
        <span
          className="mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.1)" }}
        >
          <X className="size-7" style={{ color: RED }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">{t("title")}</h1>
        <p className="mt-1 max-w-[280px] text-[13px] text-[var(--d-muted)]">
          {mine ? t("byYou") : t("byOther")}
        </p>
        {refunded && (
          <p
            className="mt-2 max-w-[300px] rounded-[12px] px-3 py-2 text-[12px] font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {t("refunded")}
          </p>
        )}
      </div>
      {reason && (
        <div className="mt-4 rounded-[18px] border border-[var(--d-line)] p-4">
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[var(--d-muted)]">{t("reason")}</span>
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
