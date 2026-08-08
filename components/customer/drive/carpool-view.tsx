"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowUpDown,
  UsersRound,
  Banknote,
  Check,
  ChevronLeft,
  Loader2,
  Search,
  Ticket,
  Wallet,
  X,
} from "lucide-react";
import {
  PlaceField,
  wilayaName,
  type PlacePick,
} from "@/components/shared/place-field";
import { nearestWilayaCode } from "@/lib/drive/interwilaya";
import { VIOLET, GO, ROSE, RED } from "./drive-modals";
import { onVisibleResumeSafe } from "@/lib/net/probe";
import {
  bookCarpoolSeats,
  cancelCarpoolBooking,
  getCarpoolHome,
  type CarpoolBooking,
  type CarpoolFlagLite,
  type CarpoolOffer,
} from "@/app/(customer)/drive/carpool-actions";

/** Jour civil Alger (UTC+1 sans DST) au format YYYY-MM-DD, décalable. */
function algiersDay(offsetDays = 0): string {
  const local = new Date(Date.now() + 3600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + offsetDays
    )
  )
    .toISOString()
    .slice(0, 10);
}

/** Durée de route estimée (≈ 70 km/h inter-wilayas) en minutes. */
function tripMinutes(km: number): number {
  return Math.max(20, Math.round((km / 70) * 60));
}

/**
 * COVOITURAGE client v3 — parcours BlaBlaCar complet : départ et arrivée au
 * niveau COMMUNE (saisie libre + suggestions, départ auto-détecté par GPS),
 * matching PAR SEGMENT (un Béjaïa → Alger via Bouira répond aussi à
 * « Bouira → Alger »), heure de montée à VOTRE arrêt, prix du tronçon
 * uniquement. Billet = PIN d'embarquement.
 */
export function CarpoolView() {
  const t = useTranslations("drive");
  const locale = useLocale();
  const isAr = locale === "ar";
  const wname = (code: string | null) => wilayaName(code, isAr);
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString(isAr ? "ar-DZ" : "fr-DZ", {
      timeZone: "Africa/Algiers",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(isAr ? "ar-DZ" : "fr-DZ", {
      timeZone: "Africa/Algiers",
      hour: "2-digit",
      minute: "2-digit",
    });
  const durLabel = (km: number) => {
    const min = tripMinutes(km);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${min} min`;
    return m > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  };
  const arrivalTime = (iso: string, km: number) =>
    fmtTime(
      new Date(new Date(iso).getTime() + tripMinutes(km) * 60000).toISOString()
    );
  /** Libellé d'un arrêt : commune choisie sinon nom de wilaya. */
  const stopLabel = (text: string | null, w: string | null) =>
    text && text.trim() !== "" ? text.split(",")[0] : wname(w);

  const [tab, setTab] = useState<"offers" | "mine">("offers");
  const [flag, setFlag] = useState<CarpoolFlagLite | null>(null);
  const [trips, setTrips] = useState<CarpoolOffer[]>([]);
  const [bookings, setBookings] = useState<CarpoolBooking[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Recherche (brouillon → appliqué au tap « Rechercher ») ───────────── */
  const [fromPick, setFromPick] = useState<PlacePick | null>(null);
  const [toPick, setToPick] = useState<PlacePick | null>(null);
  const [date, setDate] = useState(""); // "" = toutes dates
  const [pax, setPax] = useState(1);
  const [applied, setApplied] = useState<{
    from: string;
    to: string;
    date: string;
  }>({ from: "", to: "", date: "" });
  const [sort, setSort] = useState<"time" | "price">("time");

  // DÉTECTION AUTO du départ : position GPS → wilaya la plus proche, préremplie
  // en silence (référentiel local, zéro réseau). Le client peut la remplacer en
  // tapant sa commune exacte.
  const gpsTried = useRef(false);
  useEffect(() => {
    if (gpsTried.current || fromPick) return;
    gpsTried.current = true;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const w = nearestWilayaCode(pos.coords.latitude, pos.coords.longitude);
        if (!w) return;
        setFromPick((cur) =>
          cur
            ? cur
            : {
                label: wilayaName(w, isAr),
                secondary: null,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                wilaya: w,
              }
        );
      },
      () => undefined,
      { maximumAge: 180_000, timeout: 6_000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    const res = await getCarpoolHome({
      fromWilaya: applied.from || null,
      toWilaya: applied.to || null,
      date: applied.date || null,
    });
    setFlag(res.flag);
    setTrips(res.trips);
    setBookings(res.bookings);
    setLoading(false);
  }, [applied]);
  useEffect(() => {
    setLoading(true);
    void load();
    const off = onVisibleResumeSafe(() => void load());
    return off;
  }, [load]);

  const swap = () => {
    const f = fromPick;
    setFromPick(toPick);
    setToPick(f);
  };
  const search = () => {
    setApplied({
      from: fromPick?.wilaya ?? "",
      to: toPick?.wilaya ?? "",
      date,
    });
  };

  // Filtre passagers (client) + tri — sur le SEGMENT proposé.
  const shownTrips = useMemo(() => {
    const list = trips.filter((x) => x.seats_left >= pax);
    return [...list].sort((a, b) =>
      sort === "price"
        ? a.seg_price_da - b.seg_price_da ||
          +new Date(a.seg_departure_at) - +new Date(b.seg_departure_at)
        : +new Date(a.seg_departure_at) - +new Date(b.seg_departure_at)
    );
  }, [trips, pax, sort]);

  /* ── Réservation (feuille) ─────────────────────────────────────────────── */
  const [bookTrip, setBookTrip] = useState<CarpoolOffer | null>(null);
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState<"coligo_pay" | "cash">("cash");
  const [bookPending, setBookPending] = useState(false);
  const [bookError, setBookError] = useState("");
  const [pinResult, setPinResult] = useState<string | null>(null);
  const openBook = (trip: CarpoolOffer) => {
    setBookTrip(trip);
    setSeats(Math.min(pax, Math.min(4, trip.seats_left)));
    setPayment("cash");
    setBookError("");
    setPinResult(null);
  };
  const errLabel = (code?: string) => {
    const known = [
      "insufficient_balance",
      "not_enough_seats",
      "trip_unavailable",
      "own_trip",
    ];
    if (code && code.includes("feature_disabled"))
      return t("mode.interBlocked");
    return known.includes(code ?? "")
      ? t(`carpool.errors.${code}`)
      : t("carpool.errors.generic");
  };
  const submitBook = async () => {
    if (!bookTrip || bookPending) return;
    setBookPending(true);
    setBookError("");
    const res = await bookCarpoolSeats({
      tripId: bookTrip.id,
      seats,
      payment,
      operationId: crypto.randomUUID(),
      fromSeq: bookTrip.from_seq,
      toSeq: bookTrip.to_seq,
      routeLabel: `${stopLabel(bookTrip.seg_from_text, bookTrip.seg_from_wilaya)} → ${stopLabel(bookTrip.seg_to_text, bookTrip.seg_to_wilaya)}`,
    });
    setBookPending(false);
    if (!res.ok) {
      setBookError(errLabel(res.error));
      return;
    }
    setPinResult(res.pin ?? null);
    void load();
  };

  /* ── Annulation (2 taps, état local par réservation) ──────────────────── */
  const [cancelArm, setCancelArm] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState<string | null>(null);
  const doCancel = async (b: CarpoolBooking) => {
    setCancelPending(b.id);
    const res = await cancelCarpoolBooking(b.id);
    setCancelPending(null);
    setCancelArm(null);
    if (res.ok) void load();
  };

  const activeBookings = useMemo(
    () =>
      bookings.filter((b) => b.status === "booked" || b.status === "boarded"),
    [bookings]
  );

  const blockedMsg =
    flag && flag.status !== "active"
      ? ((isAr ? flag.message_ar || flag.message_fr : flag.message_fr) ??
        t("mode.interBlocked"))
      : null;

  const dateChips: { key: string; label: string }[] = [
    { key: "", label: t("carpool.anyDate") },
    { key: algiersDay(0), label: t("carpool.today") },
    { key: algiersDay(1), label: t("carpool.tomorrow") },
  ];
  const customDate = date !== "" && !dateChips.some((c) => c.key === date);

  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col overflow-y-auto bg-[var(--d-page,#F5F4F8)]">
      {/* HÉRO dégradé (langage visuel Drive) + onglets PILULES — la carte de
          recherche blanche vient chevaucher le bas du bandeau (façon Bolt). */}
      <div
        className="rounded-b-[26px] px-[18px] pt-[calc(16px+env(safe-area-inset-top))] pb-8 text-white"
        style={{
          backgroundImage: `linear-gradient(130deg, ${VIOLET} 0%, #4B1FA6 62%, #8E2F86 100%)`,
        }}
      >
        <div className="flex items-center gap-2">
          <Link
            href="/drive"
            aria-label={t("carpool.title")}
            className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white/15 text-white"
          >
            <ChevronLeft className="size-5 rtl:rotate-180" />
          </Link>
          <div className="min-w-0">
            <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
              {t("carpool.title")}
            </h1>
            <p className="truncate text-[10.5px] font-medium text-white/75">
              {t("carpool.subtitle")}
            </p>
          </div>
        </div>

        {/* Onglets segmentés (pilule blanche = actif) */}
        <div className="mt-3 flex gap-1 rounded-[14px] bg-white/15 p-1">
          {(
            [
              ["offers", t("carpool.offers"), shownTrips.length],
              ["mine", t("carpool.mine"), activeBookings.length],
            ] as const
          ).map(([k, label, count]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="drive-sora flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[11px] text-[12px] font-extrabold transition-colors"
              style={
                tab === k
                  ? {
                      background: "#fff",
                      color: VIOLET,
                      boxShadow: "0 4px 12px -6px rgba(0,0,0,.35)",
                    }
                  : { color: "rgba(255,255,255,.85)" }
              }
            >
              {label}
              <span
                className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-1.5 text-[9px] font-extrabold"
                style={
                  tab === k
                    ? { background: "#F1E9FC", color: VIOLET }
                    : { background: "rgba(255,255,255,.18)", color: "#fff" }
                }
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-[18px] pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {blockedMsg && (
          <p
            className="mb-2.5 rounded-[12px] px-3 py-2.5 text-[12px] font-semibold"
            style={{ background: "rgba(108,43,217,.08)", color: VIOLET }}
          >
            {blockedMsg}
          </p>
        )}

        {tab === "offers" && (
          <>
            {/* ── Carte de recherche façon BlaBlaCar : communes libres —
                chevauche le bas du héros dégradé (façon Bolt). ── */}
            <div className="relative z-10 -mt-9 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5 shadow-[0_18px_40px_-24px_rgba(20,22,40,.6)]">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="border-b border-[var(--d-line)] pb-1">
                    <PlaceField
                      value={fromPick}
                      onChange={setFromPick}
                      placeholder={t("carpool.fromPlaceholder")}
                      marker="origin"
                    />
                  </div>
                  <div className="pt-1">
                    <PlaceField
                      value={toPick}
                      onChange={setToPick}
                      placeholder={t("carpool.toPlaceholder")}
                      bias={
                        fromPick
                          ? { lat: fromPick.lat, lng: fromPick.lng }
                          : null
                      }
                      marker="dest"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={swap}
                  aria-label={t("carpool.swap")}
                  title={t("carpool.swap")}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-sm"
                  style={{ color: VIOLET }}
                >
                  <ArrowUpDown className="size-4" />
                </button>
              </div>

              {/* Date : chips + calendrier */}
              <div className="mt-3 flex items-center gap-1.5 overflow-x-auto">
                {dateChips.map((c) => (
                  <button
                    key={c.key || "any"}
                    type="button"
                    onClick={() => setDate(c.key)}
                    className="drive-sora flex h-8 shrink-0 items-center rounded-[14px] border px-3 text-[11px] font-bold whitespace-nowrap"
                    style={
                      date === c.key
                        ? {
                            background: "#F1E9FC",
                            color: VIOLET,
                            borderColor: "#F1E9FC",
                          }
                        : {
                            borderColor: "var(--d-line)",
                            color: "var(--d-muted)",
                          }
                    }
                  >
                    {c.label}
                  </button>
                ))}
                <input
                  type="date"
                  value={customDate ? date : ""}
                  min={algiersDay(0)}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 shrink-0 rounded-[14px] border px-2 text-[11px] font-bold outline-none"
                  style={
                    customDate
                      ? {
                          background: "#F1E9FC",
                          color: VIOLET,
                          borderColor: "#F1E9FC",
                        }
                      : {
                          borderColor: "var(--d-line)",
                          color: "var(--d-muted)",
                          background: "var(--d-surface)",
                        }
                  }
                  aria-label={t("carpool.anyDate")}
                />
              </div>

              {/* Passagers + Rechercher */}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex h-11 shrink-0 items-center rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)]">
                  <button
                    type="button"
                    onClick={() => setPax((p) => Math.max(1, p - 1))}
                    aria-label="−"
                    className="drive-sora h-full w-9 text-[16px] font-extrabold"
                  >
                    −
                  </button>
                  <span className="drive-sora flex min-w-[46px] items-center justify-center gap-1 text-[14px] font-extrabold">
                    <UsersRound className="size-4" />
                    {pax}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPax((p) => Math.min(4, p + 1))}
                    aria-label="+"
                    className="drive-sora h-full w-9 text-[16px] font-extrabold"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={search}
                  className="drive-sora flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] text-[14px] font-extrabold text-white"
                  style={{
                    background: VIOLET,
                    boxShadow: `0 10px 22px -10px ${VIOLET}`,
                  }}
                >
                  <Search className="size-4" /> {t("carpool.search")}
                </button>
              </div>
            </div>

            {/* ── Résultats ── */}
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2
                  className="size-7 animate-spin"
                  style={{ color: VIOLET }}
                />
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-center gap-1.5 overflow-x-auto">
                  <p className="me-auto shrink-0 text-[11.5px] font-bold text-[var(--d-muted)]">
                    {t("carpool.results", { count: shownTrips.length })}
                  </p>
                  {(
                    [
                      ["time", t("carpool.sortEarliest")],
                      ["price", t("carpool.sortCheapest")],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSort(k)}
                      className="drive-sora flex h-7 shrink-0 items-center rounded-[14px] border px-2.5 text-[10px] font-bold whitespace-nowrap"
                      style={
                        sort === k
                          ? {
                              background: "#F1E9FC",
                              color: VIOLET,
                              borderColor: "#F1E9FC",
                            }
                          : {
                              borderColor: "var(--d-line)",
                              color: "var(--d-muted)",
                            }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {shownTrips.length === 0 && !blockedMsg && (
                  <p className="py-10 text-center text-sm text-[var(--d-muted)]">
                    {t("carpool.empty")}
                  </p>
                )}

                {shownTrips.map((trip) => {
                  const viaNames = trip.route_wilayas
                    .slice(1, -1)
                    .map((w) => wname(w))
                    .join(" · ");
                  return (
                    <div
                      key={trip.id}
                      className="drive-rise mt-2.5 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5"
                    >
                      {/* Segment du passager : montée · durée · descente */}
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 text-center">
                          <p className="drive-sora text-[17px] leading-none font-extrabold">
                            {fmtTime(trip.seg_departure_at)}
                          </p>
                          <p className="mt-1 text-[9.5px] font-semibold text-[var(--d-muted)]">
                            {durLabel(trip.seg_km)}
                          </p>
                          <p className="mt-0.5 text-[11px] font-bold text-[var(--d-muted)]">
                            ≈ {arrivalTime(trip.seg_departure_at, trip.seg_km)}
                          </p>
                        </div>
                        <div className="flex w-3 shrink-0 flex-col items-center self-stretch pt-1.5 pb-1">
                          <span
                            className="size-[9px] shrink-0 rounded-full border-[2.5px]"
                            style={{ borderColor: VIOLET }}
                          />
                          <span className="my-0.5 w-[2px] flex-1 rounded bg-[var(--d-line)]" />
                          <span className="size-[9px] shrink-0 rounded-[2px] bg-[var(--d-ink)]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-extrabold">
                            {stopLabel(
                              trip.seg_from_text,
                              trip.seg_from_wilaya
                            )}
                          </p>
                          <p className="truncate text-[10px] font-medium text-[var(--d-muted)]">
                            {wname(trip.seg_from_wilaya)}
                          </p>
                          <p className="mt-1.5 truncate text-[13.5px] font-extrabold">
                            {stopLabel(trip.seg_to_text, trip.seg_to_wilaya)}
                          </p>
                          <p className="truncate text-[10px] font-medium text-[var(--d-muted)]">
                            {wname(trip.seg_to_wilaya)}
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p className="drive-sora text-[20px] leading-none font-extrabold">
                            {trip.seg_price_da}
                          </p>
                          <p className="text-[9.5px] font-semibold text-[var(--d-muted)]">
                            {t("carpool.perSeat")}
                          </p>
                          <p className="mt-1 text-[10px] font-bold text-[var(--d-muted)]">
                            {fmtDay(trip.seg_departure_at)}
                          </p>
                        </div>
                      </div>

                      {/* Trajet complet du chauffeur quand on monte en route */}
                      {viaNames && (
                        <p
                          className="mt-1.5 truncate text-[10.5px] font-semibold"
                          style={{ color: GO }}
                        >
                          {t("carpool.via", { stops: viaNames })}
                        </p>
                      )}

                      {/* Chauffeur + places + action */}
                      <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--d-line)] pt-2.5">
                        <span
                          className="drive-sora grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-extrabold text-white"
                          style={{
                            background: trip.female_only
                              ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                              : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                          }}
                        >
                          {trip.chauffeur_name[0]?.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold">
                            {trip.chauffeur_name}
                            {trip.chauffeur_rating != null && (
                              <span className="text-[10px] text-[#E8B53C]">
                                ★{" "}
                                {String(trip.chauffeur_rating).replace(
                                  ".",
                                  ","
                                )}
                              </span>
                            )}
                            {trip.female_only && (
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                                style={{
                                  background: "rgba(236,72,153,.13)",
                                  color: ROSE,
                                }}
                              >
                                {t("carpool.femaleOnly")}
                              </span>
                            )}
                          </span>
                          <span
                            className="mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
                            style={{
                              background: "rgba(22,179,100,.12)",
                              color: GO,
                            }}
                          >
                            <UsersRound className="size-3" />
                            {t("carpool.seatsLeft", { count: trip.seats_left })}
                          </span>
                        </span>
                        {trip.my_booking_id ? (
                          <button
                            type="button"
                            onClick={() => setTab("mine")}
                            className="drive-sora flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] px-3.5 text-[12px] font-extrabold"
                            style={{ background: "#F1E9FC", color: VIOLET }}
                          >
                            <Check className="size-3.5" /> {t("carpool.booked")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openBook(trip)}
                            className="drive-sora flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] px-4 text-[12.5px] font-extrabold text-white"
                            style={{
                              background: VIOLET,
                              boxShadow: `0 8px 18px -8px ${VIOLET}`,
                            }}
                          >
                            {t("carpool.book")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {tab === "mine" && (
          <>
            {!loading && bookings.length === 0 && (
              <p className="py-10 text-center text-sm text-[var(--d-muted)]">
                {t("carpool.emptyMine")}
              </p>
            )}
            {bookings.map((b) => {
              const active = b.status === "booked" || b.status === "boarded";
              const cancellable =
                b.trip_status === "published" && b.status === "booked";
              const segFrom = stopLabel(
                b.seg_from_text,
                b.seg_from_wilaya ?? b.from_wilaya
              );
              const segTo = stopLabel(
                b.seg_to_text,
                b.seg_to_wilaya ?? b.to_wilaya
              );
              const when = b.seg_departure_at ?? b.departure_at;
              return (
                <div
                  key={b.id}
                  className="drive-rise mb-2.5 rounded-[16px] border bg-[var(--d-surface)] p-3.5"
                  style={{
                    borderColor: active
                      ? "rgba(108,43,217,.35)"
                      : "var(--d-line)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <p className="drive-sora min-w-0 flex-1 truncate text-[13.5px] font-extrabold">
                      {isAr ? `${segFrom} ← ${segTo}` : `${segFrom} → ${segTo}`}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold"
                      style={
                        b.status === "boarded" || b.status === "completed"
                          ? { background: "rgba(22,179,100,.12)", color: GO }
                          : b.status === "booked"
                            ? { background: "#F1E9FC", color: VIOLET }
                            : {
                                background: "rgba(239,68,68,.10)",
                                color: RED,
                              }
                      }
                    >
                      {t(`carpool.status.${b.status}`)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--d-muted)]">
                    {fmtDay(when)} {fmtTime(when)} · {b.chauffeur_name} ·{" "}
                    {b.seats} × {Math.round(b.amount_da / Math.max(1, b.seats))}{" "}
                    = <b>{b.amount_da}</b> {isAr ? "دج" : "DA"}{" "}
                    {b.payment_method === "cash" ? (
                      <Banknote className="inline size-3 align-[-1px]" />
                    ) : (
                      <Wallet className="inline size-3 align-[-1px]" />
                    )}
                  </p>
                  {b.trip_status === "cancelled" && (
                    <p
                      className="mt-1 text-[11px] font-bold"
                      style={{ color: RED }}
                    >
                      {t("carpool.tripCancelled")}
                    </p>
                  )}
                  {active && (
                    <div
                      className="mt-2.5 flex items-center gap-2.5 rounded-[12px] px-3 py-2.5"
                      style={{ background: "rgba(108,43,217,.07)" }}
                    >
                      <Ticket
                        className="size-4 shrink-0"
                        style={{ color: VIOLET }}
                      />
                      <span className="min-w-0 flex-1">
                        <b className="block text-[10px] tracking-wide text-[var(--d-muted)] uppercase">
                          {t("carpool.pinTitle")}
                        </b>
                        <span
                          className="drive-sora text-[22px] font-extrabold tracking-[6px]"
                          style={{ color: VIOLET }}
                        >
                          {b.pin}
                        </span>
                      </span>
                    </div>
                  )}
                  {cancellable && (
                    <button
                      type="button"
                      disabled={cancelPending === b.id}
                      onClick={() =>
                        cancelArm === b.id
                          ? void doCancel(b)
                          : setCancelArm(b.id)
                      }
                      className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border text-[11.5px] font-semibold disabled:opacity-60"
                      style={{
                        borderColor: cancelArm === b.id ? RED : "var(--d-line)",
                        color: cancelArm === b.id ? RED : "var(--d-muted)",
                      }}
                    >
                      {cancelPending === b.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      {cancelArm === b.id
                        ? t("carpool.cancelSure")
                        : t("carpool.cancel")}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── Feuille de réservation (segment) ── */}
      {bookTrip && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45">
          <div className="w-full max-w-md rounded-t-[24px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
            {pinResult ? (
              /* Billet émis : PIN en évidence, à donner au chauffeur. */
              <div className="text-center">
                <span
                  className="mx-auto grid size-14 place-items-center rounded-full"
                  style={{ background: "rgba(22,179,100,.12)" }}
                >
                  <Ticket className="size-7" style={{ color: GO }} />
                </span>
                <h2 className="drive-sora mt-2 text-[17px] font-extrabold">
                  {t("carpool.pinTitle")}
                </h2>
                <p
                  className="drive-sora mt-1 text-[38px] font-extrabold tracking-[10px]"
                  style={{ color: VIOLET }}
                >
                  {pinResult}
                </p>
                <p className="mt-1 text-[12px] text-[var(--d-muted)]">
                  {t("carpool.pinHint")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setBookTrip(null);
                    setTab("mine");
                  }}
                  className="drive-sora mt-4 flex h-[48px] w-full items-center justify-center rounded-[14px] text-[14.5px] font-extrabold text-white"
                  style={{ background: VIOLET }}
                >
                  {t("carpool.ok")}
                </button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="drive-sora min-w-0 truncate text-[15.5px] font-extrabold">
                    {stopLabel(
                      bookTrip.seg_from_text,
                      bookTrip.seg_from_wilaya
                    )}{" "}
                    → {stopLabel(bookTrip.seg_to_text, bookTrip.seg_to_wilaya)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setBookTrip(null)}
                    aria-label={t("carpool.ok")}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--d-soft)]"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <p className="text-[11.5px] text-[var(--d-muted)]">
                  {fmtDay(bookTrip.seg_departure_at)}{" "}
                  {fmtTime(bookTrip.seg_departure_at)} ·{" "}
                  {bookTrip.chauffeur_name}
                </p>

                <div className="mt-3">
                  <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                    {t("carpool.seats")}
                  </span>
                  <div className="flex h-12 items-center rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)]">
                    <button
                      type="button"
                      onClick={() => setSeats((s) => Math.max(1, s - 1))}
                      className="drive-sora h-full w-12 text-[18px] font-extrabold"
                    >
                      −
                    </button>
                    <span className="drive-sora flex-1 text-center text-[17px] font-extrabold">
                      <UsersRound className="me-1 inline size-4 align-[-2px]" />
                      {seats}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSeats((s) =>
                          Math.min(Math.min(4, bookTrip.seats_left), s + 1)
                        )
                      }
                      className="drive-sora h-full w-12 text-[18px] font-extrabold"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="mt-2.5">
                  <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                    {t("carpool.payment")}
                  </span>
                  <div className="flex gap-2">
                    {(
                      [
                        ["cash", Banknote, t("carpool.cash")],
                        ["coligo_pay", Wallet, t("carpool.cpay")],
                      ] as const
                    ).map(([k, Icon, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPayment(k)}
                        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] text-[12px] font-bold"
                        style={
                          payment === k
                            ? {
                                borderColor: VIOLET,
                                background: "rgba(108,43,217,.07)",
                                color: VIOLET,
                              }
                            : {
                                borderColor: "var(--d-line)",
                                color: "var(--d-muted)",
                              }
                        }
                      >
                        <Icon className="size-4" /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                {bookError && (
                  <p
                    className="mt-2.5 text-center text-[11.5px] font-bold"
                    style={{ color: RED }}
                  >
                    {bookError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void submitBook()}
                  disabled={bookPending}
                  className="drive-sora mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-60"
                  style={{
                    background: GO,
                    boxShadow: `0 12px 24px -10px ${GO}`,
                  }}
                >
                  {bookPending && <Loader2 className="size-5 animate-spin" />}
                  {t("carpool.confirm")} · {seats * bookTrip.seg_price_da}{" "}
                  {isAr ? "دج" : "DA"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
