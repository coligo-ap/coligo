"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Armchair,
  Banknote,
  Check,
  ChevronLeft,
  Loader2,
  Route,
  Ticket,
  Wallet,
  X,
} from "lucide-react";
import { WILAYAS } from "@/lib/config/wilayas";
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

/**
 * COVOITURAGE côté client : départs inter-wilayas publiés par les chauffeurs,
 * réservation PAR PLACE (moins cher que la course privée), billet = PIN
 * d'embarquement. Écran plein type Drive (retour → /drive).
 */
export function CarpoolView() {
  const t = useTranslations("drive");
  const locale = useLocale();
  const isAr = locale === "ar";
  const wname = (code: string) => {
    const w = WILAYAS.find((x) => x.code === code);
    return w ? (isAr ? w.name_ar : w.name) : code;
  };
  const routeLabel = (from: string, to: string) =>
    isAr ? `${wname(from)} ← ${wname(to)}` : `${wname(from)} → ${wname(to)}`;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(isAr ? "ar-DZ" : "fr-DZ", {
      timeZone: "Africa/Algiers",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const [tab, setTab] = useState<"offers" | "mine">("offers");
  const [flag, setFlag] = useState<CarpoolFlagLite | null>(null);
  const [trips, setTrips] = useState<CarpoolOffer[]>([]);
  const [bookings, setBookings] = useState<CarpoolBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [toW, setToW] = useState("");
  const [date, setDate] = useState("");

  const load = useCallback(async () => {
    const res = await getCarpoolHome({
      toWilaya: toW || null,
      date: date || null,
    });
    setFlag(res.flag);
    setTrips(res.trips);
    setBookings(res.bookings);
    setLoading(false);
  }, [toW, date]);
  useEffect(() => {
    setLoading(true);
    void load();
    const off = onVisibleResumeSafe(() => void load());
    return off;
  }, [load]);

  /* ── Réservation (feuille) ─────────────────────────────────────────────── */
  const [bookTrip, setBookTrip] = useState<CarpoolOffer | null>(null);
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState<"coligo_pay" | "cash">("cash");
  const [bookPending, setBookPending] = useState(false);
  const [bookError, setBookError] = useState("");
  const [pinResult, setPinResult] = useState<string | null>(null);
  const openBook = (trip: CarpoolOffer) => {
    setBookTrip(trip);
    setSeats(1);
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
      routeLabel: `${wname(bookTrip.from_wilaya)} → ${wname(bookTrip.to_wilaya)}`,
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

  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col overflow-y-auto bg-[var(--d-surface)]">
      {/* En-tête */}
      <div className="px-[18px] pt-[calc(16px+env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <Link
            href="/drive"
            aria-label={t("carpool.title")}
            className="grid size-9 shrink-0 place-items-center rounded-[12px] border border-[var(--d-line)] bg-[var(--d-surface)]"
          >
            <ChevronLeft className="size-5 rtl:rotate-180" />
          </Link>
          <div className="min-w-0">
            <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
              {t("carpool.title")}
            </h1>
          </div>
        </div>
        <p className="mt-1 text-[11.5px] font-medium text-[var(--d-muted)]">
          {t("carpool.subtitle")}
        </p>
      </div>

      {/* Onglets */}
      <div className="mt-2.5 flex border-b border-[var(--d-line)]">
        {(
          [
            ["offers", t("carpool.offers"), trips.length],
            ["mine", t("carpool.mine"), activeBookings.length],
          ] as const
        ).map(([k, label, count]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="drive-sora relative h-[38px] flex-1 text-[12px] font-bold"
            style={{ color: tab === k ? VIOLET : "var(--d-muted)" }}
          >
            {label}
            <span
              className="ms-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-1.5 text-[9px] font-extrabold"
              style={
                tab === k
                  ? { background: "#F1E9FC", color: VIOLET }
                  : { background: "var(--d-soft)", color: "var(--d-muted)" }
              }
            >
              {count}
            </span>
            {tab === k && (
              <span
                className="absolute inset-x-[20%] bottom-0 h-[3px] rounded-[3px]"
                style={{ background: VIOLET }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 px-[18px] pt-2.5 pb-[calc(24px+env(safe-area-inset-bottom))]">
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
            {/* Filtres destination + date */}
            <div className="mb-2.5 flex gap-2">
              <select
                value={toW}
                onChange={(e) => setToW(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-2.5 text-[12.5px] font-bold outline-none"
              >
                <option value="">{t("carpool.allWilayas")}</option>
                {WILAYAS.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code} — {isAr ? w.name_ar : w.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 w-[130px] shrink-0 rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-2 text-[12px] font-bold outline-none"
              />
            </div>

            {loading && (
              <div className="flex justify-center py-10">
                <Loader2
                  className="size-7 animate-spin"
                  style={{ color: VIOLET }}
                />
              </div>
            )}
            {!loading && trips.length === 0 && !blockedMsg && (
              <p className="py-10 text-center text-sm text-[var(--d-muted)]">
                {t("carpool.empty")}
              </p>
            )}

            {trips.map((tr) => (
              <div
                key={tr.id}
                className="drive-rise mb-2.5 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-[12px]"
                    style={{ background: "rgba(108,43,217,.10)" }}
                  >
                    <Route className="size-5" style={{ color: VIOLET }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="drive-sora flex flex-wrap items-center gap-1.5 text-[13.5px] font-extrabold">
                      {routeLabel(tr.from_wilaya, tr.to_wilaya)}
                      {tr.female_only && (
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
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--d-muted)]">
                      {fmtDate(tr.departure_at)} · {tr.chauffeur_name}
                      {tr.chauffeur_rating != null && (
                        <span className="text-[#E8B53C]">
                          {" "}
                          ★ {String(tr.chauffeur_rating).replace(".", ",")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="drive-sora text-[19px] leading-none font-extrabold">
                      {tr.price_per_seat_da}
                    </p>
                    <p className="text-[9.5px] font-semibold text-[var(--d-muted)]">
                      {t("carpool.perSeat")}
                    </p>
                  </div>
                </div>
                {(tr.from_text || tr.to_text) && (
                  <p className="mt-1.5 truncate text-[11px] font-medium text-[var(--d-muted)]">
                    {tr.from_text ?? wname(tr.from_wilaya)} →{" "}
                    {tr.to_text ?? wname(tr.to_wilaya)}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--d-muted)]">
                    <Armchair className="size-3.5" />
                    {t("carpool.seatsLeft", { count: tr.seats_left })}
                  </span>
                  <span className="ms-auto" />
                  {tr.my_booking_id ? (
                    <button
                      type="button"
                      onClick={() => setTab("mine")}
                      className="drive-sora flex h-9 items-center gap-1.5 rounded-[11px] px-4 text-[12px] font-extrabold"
                      style={{ background: "#F1E9FC", color: VIOLET }}
                    >
                      <Check className="size-3.5" /> {t("carpool.booked")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openBook(tr)}
                      className="drive-sora flex h-9 items-center gap-1.5 rounded-[11px] px-5 text-[12.5px] font-extrabold text-white"
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
            ))}
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
                      {routeLabel(b.from_wilaya, b.to_wilaya)}
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
                    {fmtDate(b.departure_at)} · {b.chauffeur_name} · {b.seats} ×{" "}
                    {b.price_per_seat_da} = <b>{b.amount_da}</b>{" "}
                    {isAr ? "دج" : "DA"}{" "}
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

      {/* ── Feuille de réservation ── */}
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
                    {routeLabel(bookTrip.from_wilaya, bookTrip.to_wilaya)}
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
                  {fmtDate(bookTrip.departure_at)} · {bookTrip.chauffeur_name}
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
                      <Armchair className="me-1 inline size-4 align-[-2px]" />
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
                  {t("carpool.confirm")} · {seats * bookTrip.price_per_seat_da}{" "}
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
