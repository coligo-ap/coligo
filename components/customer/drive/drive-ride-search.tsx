"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDownUp,
  CreditCard,
  Crown,
  Heart,
  Loader2,
  Star,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { DriveMap } from "./drive-map";
import { ChAvatar } from "./ch-avatar";
import { DriverBadgePill } from "@/components/drive/driver-badge";
import { getDriverBadge } from "@/lib/drive/driver-badge";
import { GO, ROSE, RED, VIOLET } from "./drive-modals";
import {
  acceptDriveOffer,
  boostRide,
  cancelDriveRide,
  escalateDispatch,
  getDriveOffers,
  releaseCardOffer,
  reserveAndPayCardOffer,
  type DriveActiveRide,
  type DriveContext,
  type DriveOffer,
} from "@/app/(customer)/drive/actions";
import { clearPendingRide } from "@/lib/drive/offline-db";
import { withTimeout } from "@/lib/async/with-timeout";
import { openCheckout } from "@/lib/payments/open-checkout";
import {
  IntlPaymentSheet,
  type StripeIntentPayload,
} from "@/components/customer/intl-payment-sheet";

export function SearchScreen({
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
  const rideId = ride?.id ?? null;
  // Paiement carte À L'ACCEPTATION (mig 0386) : feuille € embarquée éventuelle,
  // et l'offre en cours de paiement (pour la relâcher si le client renonce).
  const [rideIntlIntent, setRideIntlIntent] =
    useState<StripeIntentPayload | null>(null);
  const payingOfferRef = useRef<string | null>(null);
  const isCard = ride?.payment_method === "card";

  // Trajet A → B sur la carte pendant la recherche : itinéraire ROUTIER réel
  // (OSRM, retry après le cooldown du disjoncteur), repli ligne droite en
  // attendant. Le client voit ce qu'il a demandé pendant que les offres tombent.
  const pickupPos = useMemo(
    () =>
      ride?.pickup_lat != null && ride.pickup_lng != null
        ? { lat: ride.pickup_lat, lng: ride.pickup_lng }
        : null,
    [ride?.pickup_lat, ride?.pickup_lng]
  );
  const destPos = useMemo(
    () =>
      ride?.dest_lat != null && ride.dest_lng != null
        ? { lat: ride.dest_lat, lng: ride.dest_lng }
        : null,
    [ride?.dest_lat, ride?.dest_lng]
  );
  const roadPath = useRoadPath(pickupPos, destPos, { retryMs: 65_000 });
  // Cadrage dans la BANDE VISIBLE au-dessus de la feuille d'offres (top 230px) :
  // padding bas ≈ hauteur d'écran − bande, borné pour ne jamais dépasser la
  // taille de la carte (fitBounds refuse un padding plus grand que le canvas).
  const mapPadding = useMemo(() => {
    const h = typeof window === "undefined" ? 740 : window.innerHeight;
    return {
      top: 64,
      bottom: Math.max(120, h - 220),
      left: 56,
      right: 56,
    };
  }, []);

  // Annulation AVANT choix du chauffeur : directe, sans motif, retour immédiat à
  // l'écran prix (séquestre recrédité serveur ; la course n'entre pas dans
  // l'historique — jamais attribuée). Garde-temps 8 s : `cancelDriveRide` qui ne
  // se règle jamais laisserait le bouton figé (le `finally` ne tourne pas sur une
  // promesse jamais réglée). Au-delà : on relâche et on réessaie.
  const handleCancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (rideId) await withTimeout(cancelDriveRide(rideId, null), 8000);
      else await clearPendingRide();
      onBackToPrice();
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }, [busy, rideId, onBackToPrice, t]);

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

  // Poll de rattrapage : après un paiement carte, le webhook accepte la course
  // de façon asynchrone → on sonde l'état ~3 min jusqu'à ce qu'elle ne soit
  // plus « searching » (le parent bascule alors sur l'écran course).
  const pollUntilAccepted = useCallback(async () => {
    for (let i = 0; i < 60; i++) {
      if (stopRef.current) return;
      const r = await refreshActive();
      if (!r || r.status !== "searching") return;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }, [refreshActive]);

  const choose = async (offerId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // CARTE non prépayée : paiement du prix EXACT de l'offre À L'ACCEPTATION
      // (mig 0386). Une course carte DÉJÀ prépayée (ancien flux, fenêtre de
      // déploiement) tombe dans l'acceptation normale ci-dessous.
      if (isCard && !ride?.online_paid) {
        let rail: "dzd" | "eur" = "dzd";
        try {
          rail =
            window.sessionStorage.getItem("coligo:drive:card_rail") === "eur"
              ? "eur"
              : "dzd";
        } catch {
          /* sessionStorage indisponible → CIB */
        }
        const pay = await reserveAndPayCardOffer(offerId, rail);
        if (!pay.ok) {
          setError(
            pay.error === "chauffeur_busy"
              ? t("driverBusy")
              : pay.error === "offer_expired"
                ? t("offerExpired")
                : pay.error?.startsWith("intl_")
                  ? t("intlPayUnavailable")
                  : (pay.error ?? t("genericError"))
          );
          return;
        }
        if (pay.mode === "sheet") {
          // Rail € : feuille embarquée. `busy` retombe pour laisser la feuille
          // prendre la main (poignée, 3DS…). L'offre reste réservée jusqu'au
          // succès (webhook) ou à la fermeture (releaseCardOffer).
          payingOfferRef.current = offerId;
          setRideIntlIntent({
            client_secret: pay.client_secret,
            publishable_key: pay.publishable_key,
            eur_cents: pay.eur_cents,
            total_da: pay.total_da,
          });
          setBusy(false);
          return;
        }
        // Rail CIB/Edahabia : paiement dans le navigateur intégré, l'app reste
        // montée ; on sonde jusqu'à l'acceptation par le webhook.
        await openCheckout(pay.url);
        void pollUntilAccepted();
        return;
      }

      // Espèces / Coligo Pay : acceptation directe (inchangé).
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
      {pickupPos && (
        <DriveMap
          markers={[
            { id: "me", pos: pickupPos, kind: "me", label: "A" },
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
          route={destPos ? (roadPath ?? [pickupPos, destPos]) : null}
          padding={mapPadding}
        />
      )}
      <div className="absolute inset-x-0 top-[230px] bottom-0 z-10 overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-22px_rgba(20,22,40,.3)]">
        {/* En-tête STICKY : poignée + statut + bouton ROUGE « Annuler ». Reste
            épinglé en haut du sheet → toujours accessible même si la liste des
            offres est longue (plus besoin de scroller jusqu'en bas pour annuler). */}
        <div className="sticky top-0 z-30 -mx-5 -mt-3.5 mb-3 rounded-t-[28px] bg-[var(--d-surface)] px-5 pt-3.5 pb-3">
          <div className="mx-auto mb-3 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
          {/* Statut seul (le bouton « Annuler » vit désormais sur la carte, en
              haut à droite — demande produit). */}
          <div
            className="flex min-w-0 items-center gap-2 text-[13px] font-bold"
            style={{ color: VIOLET }}
          >
            {!offlineQueued && (
              <span
                className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--d-accent)]"
                style={{ borderTopColor: VIOLET }}
              />
            )}
            <span className="truncate">
              {offlineQueued
                ? t("offlineTitle")
                : offers.length > 0
                  ? t("responded", { count: offers.length })
                  : t("incoming")}
            </span>
          </div>
          {error && (
            <p
              className="mt-2 text-[12px] font-semibold"
              style={{ color: RED }}
            >
              {error}
            </p>
          )}
        </div>

        {/* CARTE (mig 0386) : plus de bandeau « payer avant diffusion ». La
            course carte reçoit les offres comme une course espèces ; le
            paiement du prix EXACT se fait au TAP sur un chauffeur (choose). */}
        {isCard && !ride?.online_paid && offers.length > 0 && (
          <div
            className="mb-3 flex items-center gap-2 rounded-[13px] border-[1.5px] border-dashed px-3 py-2"
            style={{ borderColor: VIOLET }}
          >
            <CreditCard className="size-4 shrink-0" style={{ color: VIOLET }} />
            <span className="text-[11.5px] leading-snug font-semibold text-[var(--d-muted)]">
              {t("cardPayOnAccept")}
            </span>
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
                  <Heart className="size-2.5 shrink-0" fill="currentColor" />
                  {t("tagFav")}
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
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#B45309]">
                        <Star
                          className="size-3 shrink-0"
                          style={{ color: "#E8B53C", fill: "#E8B53C" }}
                        />
                        {String(o.rating).replace(".", ",")}
                      </span>
                    )}
                    {o.is_premium && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#E8B53C] px-2 py-0.5 text-[9.5px] font-extrabold text-[#3a2c00]">
                        <Crown
                          className="size-2.5 shrink-0"
                          fill="currentColor"
                        />
                        Premium
                      </span>
                    )}
                    {o.is_priority && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-2 py-0.5 text-[9.5px] font-extrabold text-white">
                        <Zap
                          className="size-2.5 shrink-0"
                          fill="currentColor"
                        />
                        Prioritaire
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
                    className="drive-shine mt-1 rounded-[12px] px-3.5 py-2 text-xs font-extrabold text-white transition-transform active:scale-95 disabled:opacity-50"
                    style={{
                      background: VIOLET,
                      boxShadow: "0 8px 18px -8px rgba(108,43,217,.7)",
                    }}
                  >
                    {t("choose")}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Annuler la recherche — épinglé sur la CARTE, en HAUT À DROITE (demande
          produit). Visible tant qu'une course est en recherche ; annule la
          course (séquestre recrédité serveur) et revient à l'écran prix. */}
      {ride && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          aria-label={t("cancelSearch")}
          className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-4 z-20 inline-flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-extrabold text-white shadow-lg transition-transform active:scale-95 disabled:opacity-60"
          style={{ background: RED }}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
          {t("cancelSearch")}
        </button>
      )}

      {/* Retour arrière vers l'écran prix tant qu'aucune course (file hors-ligne). */}
      {!ride && !offlineQueued && (
        <button
          type="button"
          onClick={onBackToPrice}
          className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-4 z-20 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        >
          <X className="size-5" />
        </button>
      )}

      {/* Rail € : feuille de paiement embarquée du prix EXACT de l'offre.
          Succès → le webhook accepte, on sonde jusqu'à la bascule. Fermeture
          → on relâche la réservation (offre re-disponible, rien n'a changé). */}
      {rideIntlIntent && (
        <IntlPaymentSheet
          intent={rideIntlIntent}
          onSuccess={() => {
            setRideIntlIntent(null);
            payingOfferRef.current = null;
            void pollUntilAccepted();
          }}
          onClose={() => {
            const oid = payingOfferRef.current;
            setRideIntlIntent(null);
            payingOfferRef.current = null;
            if (oid) void releaseCardOffer(oid);
          }}
        />
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
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
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
