"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Car,
  ChevronLeft,
  Clock,
  History,
  Loader2,
  Pencil,
  Route,
  User,
  Users,
  Zap,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { getPosition } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";
import { reverseGeocode } from "@/app/(customer)/actions";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { DriveMap, type LatLng } from "./drive-map";
import {
  DepModal,
  GhostBtn,
  PrimaryBtn,
  ProxModal,
  GO,
  ROSE,
  VIOLET,
} from "./drive-modals";
import { DriveRide } from "./drive-ride";
import {
  clearPendingRide,
  getPendingRide,
  queueRideRequest,
} from "@/lib/drive/offline-db";
import {
  getDriveActiveRide,
  getDriveContext,
  getDriveQuotes,
  requestDriveRide,
  type DriveActiveRide,
  type DriveContext,
  type DriveQuote,
} from "@/app/(customer)/drive/actions";

/**
 * Coligo Drive — parcours client conforme à MAQUETTE-vtc-coligo.html :
 * trajet (GPS / épingle carte) → gammes + paiement + options (boost, femme
 * au volant, pour un proche) → offres des chauffeurs → course → fin.
 */

export type Pt = {
  lat: number;
  lng: number;
  text: string | null;
  gps?: boolean;
};
type Gamme = "classic" | "confort" | "moto";
type Screen = "home" | "mappick" | "price" | "ride";

const GAMME_IMG: Record<Gamme, string> = {
  classic: "/drive/gamme-classic.png",
  confort: "/drive/gamme-confort.png",
  moto: "/drive/gamme-moto.png",
};

const rnd5 = (v: number) => Math.round(v / 5) * 5;

export function DriveView() {
  const t = useTranslations("drive");
  const router = useRouter();
  const [ctx, setCtx] = useState<DriveContext | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [booted, setBooted] = useState(false);

  // Trajet
  const [pickup, setPickup] = useState<Pt | null>(null);
  const [dest, setDest] = useState<Pt | null>(null);
  const [mapPickFor, setMapPickFor] = useState<"dep" | "dest">("dest");

  // Choix course (écran prix)
  const [quotes, setQuotes] = useState<Record<Gamme, DriveQuote> | null>(null);
  const [gamme, setGamme] = useState<Gamme>("classic");
  const [price, setPrice] = useState(0);
  const [payMode, setPayMode] = useState<"cash" | "card" | "coligo_pay">(
    "cash"
  );
  const [boostOn, setBoostOn] = useState(false);
  const [boostAmt, setBoostAmt] = useState(10);
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [prox, setProx] = useState<{ name: string; phone: string } | null>(
    null
  );

  // Course active (recherche / en route / fin)
  const [active, setActive] = useState<DriveActiveRide | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [offlineQueued, setOfflineQueued] = useState(false);

  // Modales
  const [depOpen, setDepOpen] = useState(false);
  const [proxOpen, setProxOpen] = useState(false);

  /* ───────── Boot : contexte + course active + GPS ───────── */
  useEffect(() => {
    void (async () => {
      const [c, ride] = await Promise.all([
        getDriveContext(),
        getDriveActiveRide(),
      ]);
      setCtx(c);
      if (ride) {
        setActive(ride);
        setScreen("ride");
      }
      setBooted(true);
    })();
  }, []);

  // Départ = position actuelle (GPS) par défaut.
  useEffect(() => {
    void (async () => {
      try {
        const p = await getPosition();
        const r = await reverseGeocode({
          latitude: p.latitude,
          longitude: p.longitude,
        });
        setPickup((prev) =>
          prev && !prev.gps
            ? prev
            : {
                lat: p.latitude,
                lng: p.longitude,
                text: r?.display ?? null,
                gps: true,
              }
        );
      } catch {
        /* géoloc refusée : le client choisira sur la carte */
      }
    })();
  }, []);

  const distanceKm = useMemo(
    () =>
      pickup && dest
        ? Math.max(
            0.1,
            Number(
              haversineKm(
                { lat: pickup.lat, lng: pickup.lng },
                { lat: dest.lat, lng: dest.lng }
              ).toFixed(2)
            )
          )
        : 0,
    [pickup, dest]
  );
  const etaMin = Math.max(2, Math.round(distanceKm * 2.2));

  /* ───────── Devis par gamme à l'arrivée sur l'écran prix ───────── */
  useEffect(() => {
    if (screen !== "price" || distanceKm <= 0) return;
    void (async () => {
      const q = await getDriveQuotes(distanceKm);
      setQuotes(q);
      setPrice((p) => (p > 0 ? p : q.classic.recommended));
    })();
  }, [screen, distanceKm]);

  const quote = quotes?.[gamme] ?? null;
  const defBoost = useCallback(
    (forPrice: number) =>
      Math.max(
        ctx?.boostMin ?? 10,
        rnd5(forPrice * (ctx?.boostDefaultRate ?? 0.1))
      ),
    [ctx]
  );
  const offerPrice = price + (boostOn ? boostAmt : 0);

  const pickGamme = (g: Gamme) => {
    setGamme(g);
    const q = quotes?.[g];
    if (q) {
      setPrice(q.recommended);
      if (boostOn) setBoostAmt(defBoost(q.recommended));
    }
  };
  const stepPrice = (dir: 1 | -1) => {
    const step = ctx?.priceStep ?? 20;
    const floor = quote?.floor ?? 0;
    setPrice((p) => {
      const np = Math.max(floor, p + dir * step);
      if (boostOn) setBoostAmt(defBoost(np));
      return np;
    });
  };

  /* ───────── Demande (+ file hors-ligne, maquette offbanner) ───────── */
  const buildPayload = useCallback(() => {
    if (!pickup || !dest) return null;
    return {
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      pickup_text: pickup.gps ? (pickup.text ?? t("myPosition")) : pickup.text,
      dest_lat: dest.lat,
      dest_lng: dest.lng,
      dest_text: dest.text,
      distance_km: distanceKm,
      proposed_price_da: price,
      payment_method: payMode,
      gamme,
      boost_da: boostOn ? boostAmt : 0,
      female_only: femaleOnly,
      proxy_name: prox?.name ?? null,
      proxy_phone: prox?.phone ?? null,
      operation_id: `drv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }, [
    pickup,
    dest,
    distanceKm,
    price,
    payMode,
    gamme,
    boostOn,
    boostAmt,
    femaleOnly,
    prox,
    t,
  ]);

  const refreshActive = useCallback(async () => {
    const ride = await getDriveActiveRide();
    setActive(ride);
    return ride;
  }, []);

  const submitRequest = async () => {
    const payload = buildPayload();
    if (!payload || submitting) return;
    setRequestError(null);
    // Hors connexion : demande en file Dexie, envoi auto au retour réseau (C8).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueRideRequest(payload.operation_id, payload);
      setOfflineQueued(true);
      setScreen("ride");
      return;
    }
    setSubmitting(true);
    const res = await requestDriveRide(payload);
    setSubmitting(false);
    if (!res.ok) {
      setRequestError(res.error ?? t("requestFailed"));
      return;
    }
    await refreshActive();
    setScreen("ride");
  };

  // Envoi auto de la demande en file (Dexie) dès le retour du réseau.
  useEffect(() => {
    const flush = async () => {
      const pending = await getPendingRide();
      if (!pending) return;
      setOfflineQueued(true);
      try {
        const res = await requestDriveRide(
          pending.payload as Parameters<typeof requestDriveRide>[0]
        );
        if (res.ok) {
          await clearPendingRide();
          setOfflineQueued(false);
          await refreshActive();
          setScreen("ride");
        }
      } catch {
        /* réessaiera au prochain retour réseau */
      }
    };
    if (typeof navigator !== "undefined" && navigator.onLine) void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [refreshActive]);

  const resetAll = useCallback(() => {
    setActive(null);
    setScreen("home");
    setDest(null);
    setPrice(0);
    setQuotes(null);
    setBoostOn(false);
    setFemaleOnly(false);
    setProx(null);
    setPayMode("cash");
    setGamme("classic");
    setOfflineQueued(false);
  }, []);

  if (!booted || !ctx) {
    return (
      <div className="grid min-h-[70vh] place-items-center bg-[var(--d-page)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  /* ════════════════ ÉCRAN COURSE (recherche → fin) ════════════════ */
  if (screen === "ride") {
    return (
      <DriveRide
        ctx={ctx}
        active={active}
        offlineQueued={offlineQueued}
        refreshActive={refreshActive}
        onExit={resetAll}
        onBackToPrice={() => {
          setActive(null);
          setScreen("price");
        }}
      />
    );
  }

  /* ════════════════ CHOIX SUR LA CARTE (épingle centrale) ════════════════ */
  if (screen === "mappick") {
    return (
      <MapPickScreen
        forWhat={mapPickFor}
        initial={
          mapPickFor === "dep"
            ? (pickup ?? undefined)
            : (dest ?? pickup ?? undefined)
        }
        onBack={() => setScreen(dest || mapPickFor === "dep" ? "home" : "home")}
        onConfirm={(p) => {
          if (mapPickFor === "dep") setPickup({ ...p, gps: false });
          else setDest(p);
          setScreen("home");
        }}
      />
    );
  }

  /* ════════════════ PRIX + GAMMES + OPTIONS ════════════════ */
  if (screen === "price" && pickup && dest) {
    const floorLabel = !quote
      ? null
      : price < quote.recommended
        ? t("price.belowReco", { reco: quote.recommended })
        : price === quote.recommended
          ? t("price.atReco")
          : t("price.aboveReco", { reco: quote.recommended });
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-[var(--d-surface)]">
        {/* Carte du trajet (haut d'écran, maquette s-price) */}
        <div className="relative h-[196px] shrink-0 bg-[var(--d-page)]">
          <DriveMap
            markers={[
              { id: "me", pos: pickup, kind: "me" },
              { id: "dest", pos: dest, kind: "pin" },
            ]}
            route={[pickup, dest]}
            padding={{ top: 40, bottom: 30, left: 50, right: 50 }}
            className="absolute inset-0"
          />
          <button
            type="button"
            onClick={() => setScreen("home")}
            className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
            aria-label={t("back")}
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <div className="drive-jakarta -mt-4 flex-1 overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-8">
          <div className="mx-auto mb-4 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
          {/* Départ / destination (rail pointillé) */}
          <Leg
            label={t("departure")}
            value={
              pickup.gps
                ? `${t("myPosition")}${pickup.text ? ` · ${pickup.text}` : ""}`
                : (pickup.text ?? "—")
            }
            start
          />
          <Leg label={t("destination")} value={dest.text ?? "—"} />
          <div className="mt-1 mb-3.5 flex gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
              <Route className="size-3.5" />{" "}
              {String(distanceKm).replace(".", ",")} km
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
              <Clock className="size-3.5" /> ~{etaMin} min
            </span>
          </div>

          {/* Gammes : cards carrées défilables (photos maquette) */}
          <div className="-mx-1 mb-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-1 pb-1.5">
            {(["classic", "confort", "moto"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => pickGamme(g)}
                className="flex w-[108px] shrink-0 flex-col items-center rounded-[18px] border-[1.5px] px-2 pt-3 pb-2.5 text-center"
                style={
                  gamme === g
                    ? {
                        borderColor: VIOLET,
                        background: "#EEEEFD",
                        boxShadow: "0 8px 20px -10px rgba(91,91,230,.42)",
                      }
                    : { borderColor: "var(--d-line)", background: "#fff" }
                }
              >
                <Image
                  src={GAMME_IMG[g]}
                  alt={t(`gammes.${g}`)}
                  width={88}
                  height={62}
                  className="pointer-events-none h-[62px] w-[88px] object-contain"
                />
                <b className="drive-sora mt-1 text-[13px]">
                  {t(`gammes.${g}`)}
                </b>
                <span className="mt-0.5">
                  <b className="text-[12px]" style={{ color: VIOLET }}>
                    {quotes ? formatDA(quotes[g].recommended) : "…"}
                  </b>
                  <span className="block text-[9px] font-semibold text-[var(--d-muted)]">
                    {t("price.recommended")}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Moyen de paiement — choisi ICI (maquette §2.2) */}
          <p className="mb-2 text-[13.5px] font-bold">{t("price.payTitle")}</p>
          <div className="mb-3 flex gap-2">
            {(
              [
                ["cash", t("pay.cash")],
                ["card", t("pay.card")],
                ["coligo_pay", "Coligo Pay"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayMode(m)}
                className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-[12px] font-bold"
                style={
                  payMode === m
                    ? {
                        borderColor: VIOLET,
                        background: "#EEEEFD",
                        color: VIOLET,
                      }
                    : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Votre offre (prix recommandé pré-rempli, ± pas de 20) */}
          <div className="mb-3 rounded-[18px] bg-[var(--d-soft)] p-4 text-center">
            <p className="text-xs font-semibold text-[var(--d-muted)]">
              {t("price.offerLabel")}
            </p>
            <div className="my-1.5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => stepPrice(-1)}
                className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold"
                style={{ color: VIOLET }}
              >
                −
              </button>
              <div
                className="drive-sora min-w-[140px] text-[38px] font-extrabold tracking-[-1.5px]"
                style={boostOn ? { color: GO } : undefined}
              >
                {offerPrice}{" "}
                <small className="text-[17px] text-[var(--d-muted)]">DA</small>
              </div>
              <button
                type="button"
                onClick={() => stepPrice(1)}
                className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold"
                style={{ color: VIOLET }}
              >
                +
              </button>
            </div>
            <p className="text-[11.5px] text-[var(--d-muted)]">
              {floorLabel}
              {boostOn && (
                <span className="font-bold" style={{ color: GO }}>
                  {" "}
                  · ⚡ {t("price.boostIncluded", { amount: boostAmt })}
                </span>
              )}
            </p>
            {quote && quote.high > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1 text-[11px] font-bold text-[var(--d-muted)]">
                {t("price.similar")}{" "}
                <b className="text-[var(--d-ink)]">
                  {quote.low}–{quote.high} DA
                </b>
              </p>
            )}
          </div>

          {/* Booster (vert) */}
          <OptRow
            color={GO}
            soft="rgba(22,179,100,.12)"
            icon={<Zap className="size-[18px]" />}
            title={t("boost.title")}
            sub={t("boost.sub")}
            on={boostOn}
            onToggle={() => {
              setBoostOn((b) => {
                if (!b) setBoostAmt(defBoost(price));
                return !b;
              });
            }}
          />
          {boostOn && (
            <div className="flex items-center justify-between py-2 pl-11">
              <span className="text-xs font-semibold text-[var(--d-muted)]">
                {t("boost.amount")}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setBoostAmt((a) =>
                      Math.max(ctx.boostMin, a - ctx.boostStep)
                    )
                  }
                  className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                  style={{ color: VIOLET }}
                >
                  −
                </button>
                <span className="min-w-[74px] text-center text-[13px] font-semibold text-[var(--d-muted)]">
                  <b className="drive-sora text-[20px] text-[var(--d-ink)]">
                    {boostAmt}
                  </b>{" "}
                  DA
                </span>
                <button
                  type="button"
                  onClick={() => setBoostAmt((a) => a + ctx.boostStep)}
                  className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                  style={{ color: VIOLET }}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Femme au volant (rose) — clientes au profil vérifié uniquement */}
          {ctx.femaleFilterEnabled && ctx.isFemaleVerified && (
            <OptRow
              color={ROSE}
              soft="rgba(236,72,153,.13)"
              icon={<User className="size-[18px]" />}
              title={t("female.title")}
              sub={
                femaleOnly
                  ? t("female.subOn")
                  : t("female.subOff", { count: ctx.femaleOnlineCount })
              }
              on={femaleOnly}
              onToggle={() => setFemaleOnly((v) => !v)}
            />
          )}

          {/* Pour un proche */}
          <OptRow
            color="var(--d-ink)"
            soft="var(--d-soft)"
            icon={<Users className="size-[18px]" />}
            title={t("prox.title")}
            sub={prox ? t("prox.subOn", { name: prox.name }) : t("prox.subOff")}
            on={!!prox}
            onToggle={() => {
              if (prox) setProx(null);
              else setProxOpen(true);
            }}
          />

          {requestError && (
            <p
              className="mt-2 rounded-[12px] bg-[rgba(229,72,77,.1)] px-3 py-2 text-center text-xs font-bold"
              style={{ color: "#E5484D" }}
            >
              {requestError}
            </p>
          )}
          <PrimaryBtn onClick={submitRequest} disabled={submitting || !quote}>
            {submitting ? <Loader2 className="size-5 animate-spin" /> : null}
            {t("price.propose", { price: offerPrice })}
          </PrimaryBtn>
        </div>

        <ProxModal
          open={proxOpen}
          onClose={() => setProxOpen(false)}
          onConfirm={(name, phone) => {
            setProx({ name, phone });
            setProxOpen(false);
          }}
        />
      </div>
    );
  }

  /* ════════════════ ACCUEIL DRIVE (trajet) ════════════════ */
  return (
    <div className="drive-jakarta fixed inset-0 z-40 bg-[var(--d-page)]">
      <DriveMap
        markers={pickup ? [{ id: "me", pos: pickup, kind: "me" }] : []}
        padding={{ top: 100, bottom: 420, left: 60, right: 60 }}
      />
      {/* Pill « Coligo Drive » */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold shadow-lg">
        <Car className="size-4" style={{ color: VIOLET }} />
        <span className="drive-sora">Coligo Drive</span>
      </div>
      {/* Historique */}
      <button
        type="button"
        onClick={() => router.push("/drive/historique")}
        className="absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2 text-xs font-bold shadow-lg"
      >
        <History className="size-3.5" /> {t("history")}
      </button>

      {/* Feuille « Votre trajet » */}
      <div className="absolute right-0 bottom-[64px] left-0 z-10 rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-4 shadow-[0_-16px_40px_-22px_rgba(20,22,40,.3)]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        <h1 className="drive-sora mb-2 text-[21px] font-extrabold tracking-[-0.5px]">
          {t("home.title")}
        </h1>

        <button
          type="button"
          onClick={() => setDepOpen(true)}
          className="mb-2.5 flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
        >
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ background: VIOLET }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
              {t("departure")}
            </span>
            <span className="block truncate text-[14.5px] font-bold">
              {pickup?.gps
                ? t("myPosition")
                : (pickup?.text ?? t("home.locating"))}
            </span>
          </span>
          {pickup?.gps && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold"
              style={{ background: "#EEEEFD", color: VIOLET }}
            >
              GPS
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setMapPickFor("dest");
            setScreen("mappick");
          }}
          className="mb-2.5 flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
        >
          <span className="size-3 shrink-0 rounded-[3px] bg-[var(--d-ink)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
              {t("destination")}
            </span>
            <span
              className={cn(
                "block truncate text-[14.5px] font-bold",
                !dest && "font-semibold text-[var(--d-muted)]"
              )}
            >
              {dest?.text ?? t("home.whereTo")}
            </span>
          </span>
          <Pencil className="size-4 shrink-0 text-[var(--d-muted)]" />
        </button>

        <PrimaryBtn
          onClick={() => setScreen("price")}
          disabled={!pickup || !dest}
          className="!mt-1"
        >
          {t("home.continue")}
        </PrimaryBtn>

        {/* Destinations récentes */}
        <div className="mt-1.5">
          {ctx.recents.map((r) => (
            <button
              key={r.text}
              type="button"
              onClick={() => setDest({ lat: r.lat, lng: r.lng, text: r.text })}
              className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-0.5 py-2.5 text-left text-[13.5px] font-semibold last:border-b-0"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                <Clock className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">{r.text}</span>
            </button>
          ))}
          {ctx.lastRide && (
            <div className="flex w-full items-center gap-3 px-0.5 py-2.5 text-left text-[13.5px] font-semibold">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                <Car className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {ctx.lastRide.dest_text ?? "—"}
                </span>
                <small className="block text-[11px] font-medium text-[var(--d-muted)]">
                  {[
                    ctx.lastRide.chauffeur_name,
                    ctx.lastRide.price_da
                      ? formatDA(ctx.lastRide.price_da)
                      : null,
                    ctx.lastRide.completed
                      ? t("status.completed")
                      : t("status.cancelled"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </div>
          )}
        </div>
      </div>

      <CustomerBottomNav />
      <DepModal
        open={depOpen}
        onClose={() => setDepOpen(false)}
        onGps={async () => {
          setDepOpen(false);
          try {
            const p = await getPosition();
            const r = await reverseGeocode({
              latitude: p.latitude,
              longitude: p.longitude,
            });
            setPickup({
              lat: p.latitude,
              lng: p.longitude,
              text: r?.display ?? null,
              gps: true,
            });
          } catch {
            /* ignore */
          }
        }}
        onMap={() => {
          setDepOpen(false);
          setMapPickFor("dep");
          setScreen("mappick");
        }}
      />
    </div>
  );
}

/* ─────────────── Écran : choix sur la carte (épingle centrale fixe) ─────────────── */

function MapPickScreen({
  forWhat,
  initial,
  onBack,
  onConfirm,
}: {
  forWhat: "dep" | "dest";
  initial?: Pt;
  onBack: () => void;
  onConfirm: (p: { lat: number; lng: number; text: string | null }) => void;
}) {
  const t = useTranslations("drive.mappick");
  const [center, setCenter] = useState<LatLng | null>(initial ?? null);
  const [addr, setAddr] = useState<string | null>(initial?.text ?? null);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Repli : si la rue est introuvable, on affiche les coordonnées GPS EXACTES
  // du point sélectionné (et on les garde comme libellé du point).
  const gpsLabel = (c: LatLng) => `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;

  const onMove = useCallback((c: LatLng) => {
    setCenter(c);
    setResolving(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await reverseGeocode({ latitude: c.lat, longitude: c.lng });
        setAddr(r?.display ?? null);
      } catch {
        setAddr(null);
      } finally {
        setResolving(false);
      }
    }, 450);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--d-page)]">
      <DriveMap
        markers={initial ? [{ id: "init", pos: initial, kind: "me" }] : []}
        interactive
        onMove={onMove}
      />
      <button
        type="button"
        onClick={onBack}
        className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        aria-label="retour"
      >
        <ChevronLeft className="size-5" />
      </button>
      {/* Épingle centrale fixe (la carte se déplace dessous) */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <div
          className="size-[22px] rounded-full border-4 border-white"
          style={{
            background: VIOLET,
            boxShadow: "0 6px 16px -4px rgba(91,91,230,.42)",
          }}
        />
        <div className="mx-auto h-3.5 w-[3px] rounded-sm bg-[var(--d-ink)]" />
        <div className="mx-auto mt-1 size-[7px] rounded-full bg-[rgba(8,9,15,.3)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <p className="mb-1 text-[13px] text-[var(--d-muted)]">
          {forWhat === "dep" ? t("depLabel") : t("destLabel")}
        </p>
        <p className="drive-sora mb-0.5 min-h-[24px] text-[17px] font-extrabold">
          {center
            ? resolving
              ? "…"
              : (addr ?? t("gpsPoint", { coords: gpsLabel(center) }))
            : t("moveMap")}
        </p>
        {center && addr && !resolving && (
          <p className="mb-2 text-[11px] text-[var(--d-muted)] tabular-nums">
            GPS · {gpsLabel(center)}
          </p>
        )}
        <PrimaryBtn
          disabled={!center || resolving}
          onClick={() =>
            center &&
            onConfirm({
              lat: center.lat,
              lng: center.lng,
              text: addr ?? t("gpsPoint", { coords: gpsLabel(center) }),
            })
          }
        >
          {t("confirm")}
        </PrimaryBtn>
        <GhostBtn onClick={onBack}>{t("back")}</GhostBtn>
      </div>
    </div>
  );
}

/* ─────────────── Petits composants partagés ─────────────── */

function Leg({
  label,
  value,
  start,
}: {
  label: string;
  value: string;
  start?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5">
        <span
          className={cn(
            "size-2.5",
            start ? "rounded-full" : "rounded-[2px] bg-[var(--d-ink)]"
          )}
          style={start ? { background: VIOLET } : undefined}
        />
        {start && (
          <span
            className="my-0.5 w-[2px] flex-1 opacity-40"
            style={{
              minHeight: 18,
              background:
                "repeating-linear-gradient(to bottom,#0B0C12 0 4px,transparent 4px 9px)",
            }}
          />
        )}
      </div>
      <div className="flex-1 pb-2.5">
        <p className="text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

function OptRow({
  color,
  soft,
  icon,
  title,
  sub,
  on,
  onToggle,
}: {
  color: string;
  soft: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--d-line)] py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid size-[34px] shrink-0 place-items-center rounded-[11px]"
          style={{ background: soft, color }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <b
            className="block text-[13.5px]"
            style={{ color: color === "var(--d-ink)" ? undefined : color }}
          >
            {title}
          </b>
          <span className="block truncate text-[11px] text-[var(--d-muted)]">
            {sub}
          </span>
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: on ? color : "var(--d-line)" }}
      >
        <span
          className="absolute top-[3px] size-[22px] rounded-full bg-white shadow transition-all"
          style={{ left: on ? 23 : 3 }}
        />
      </button>
    </div>
  );
}
