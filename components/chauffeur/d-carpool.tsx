"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  Armchair,
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  Loader2,
  Plus,
  Route,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { WILAYAS } from "@/lib/config/wilayas";
import { WILAYA_CENTROIDS } from "@/lib/config/wilaya-centroids";
import {
  VIOLET,
  GO,
  ROSE,
  RED,
} from "@/components/customer/drive/drive-modals";
import { onVisibleResumeSafe } from "@/lib/net/probe";
import {
  carpoolBoard,
  carpoolCancelTrip,
  carpoolComplete,
  carpoolPublish,
  carpoolStart,
  getCarpoolTripBookings,
  getMyCarpoolTrips,
  type CarpoolTrip,
  type CarpoolTripBooking,
} from "@/app/(chauffeur)/actions";

/** Distance approximative entre 2 chefs-lieux (hint du formulaire). */
function wilayaKm(a: string, b: string): number | null {
  const ca = WILAYA_CENTROIDS[a];
  const cb = WILAYA_CENTROIDS[b];
  if (!ca || !cb) return null;
  const R = 6371;
  const dLat = ((cb.lat - ca.lat) * Math.PI) / 180;
  const dLng = ((cb.lng - ca.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((ca.lat * Math.PI) / 180) *
      Math.cos((cb.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/**
 * Écran COVOITURAGE chauffeur : publier un départ inter-wilayas par PLACES,
 * suivre ses réservations, embarquer par PIN, démarrer/terminer/annuler.
 * FR/AR en dur (comme le reste de l'espace chauffeur).
 */
export function DCarpool() {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const wname = (code: string) => {
    const w = WILAYAS.find((x) => x.code === code);
    return w ? (isAr ? w.name_ar : w.name) : code;
  };
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(isAr ? "ar-DZ" : "fr-DZ", {
      timeZone: "Africa/Algiers",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const [trips, setTrips] = useState<CarpoolTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bookings, setBookings] = useState<
    Record<string, CarpoolTripBooking[]>
  >({});
  // États LOCAUX par départ (jamais un verrou global de page).
  const [pinInput, setPinInput] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmArm, setConfirmArm] = useState<Record<string, string | null>>(
    {}
  );

  const load = useCallback(async () => {
    const list = await getMyCarpoolTrips();
    setTrips(list);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const off = onVisibleResumeSafe(() => void load());
    return off;
  }, [load]);

  const loadBookings = useCallback(async (tripId: string) => {
    const list = await getCarpoolTripBookings(tripId);
    setBookings((b) => ({ ...b, [tripId]: list }));
  }, []);
  const toggleExpand = (tripId: string) => {
    setExpanded((e) => (e === tripId ? null : tripId));
    void loadBookings(tripId);
  };

  const errorLabel = (code?: string) => {
    if (!code) return tr("Action impossible", "تعذّر تنفيذ العملية");
    if (code.includes("feature_disabled"))
      return tr(
        "Le covoiturage est temporairement suspendu par l'équipe Coligo.",
        "علّق فريق كوليغو خدمة المشاركة مؤقتًا."
      );
    const map: Record<string, [string, string]> = {
      not_a_chauffeur: ["Compte chauffeur requis.", "حساب سائق مطلوب."],
      not_female_verified: [
        "Option « femme au volant » réservée aux conductrices vérifiées.",
        "خيار « امرأة خلف المقود » للسائقات الموثّقات فقط.",
      ],
      bad_route: [
        "Choisissez deux wilayas différentes.",
        "اختر ولايتين مختلفتين.",
      ],
      not_interwilaya: [
        "Trajet trop court pour un inter-wilayas.",
        "المسافة قصيرة جدًا لمشوار بين الولايات.",
      ],
      bad_departure: [
        "Heure de départ invalide (au moins dans 30 min).",
        "وقت الانطلاق غير صالح (بعد 30 دقيقة على الأقل).",
      ],
      bad_input: [
        "Vérifiez les places et le prix (min 50 DA).",
        "تحقق من المقاعد والسعر (50 دج على الأقل).",
      ],
      too_many_trips: [
        "Maximum 3 départs actifs à la fois.",
        "3 رحلات نشطة كحد أقصى.",
      ],
      bad_pin: [
        "PIN inconnu pour ce départ.",
        "رمز PIN غير معروف لهذه الرحلة.",
      ],
      trip_closed: ["Ce départ est clôturé.", "هذه الرحلة مغلقة."],
      not_published: [
        "Ce départ n'est plus modifiable.",
        "لم تعد هذه الرحلة قابلة للتعديل.",
      ],
      not_started: ["Démarrez d'abord le départ.", "ابدأ الرحلة أولًا."],
    };
    const m = map[code];
    return m ? tr(m[0], m[1]) : code;
  };

  const run = async (
    tripId: string,
    action: string,
    fn: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setPending((p) => ({ ...p, [tripId]: action }));
    setErrors((e) => ({ ...e, [tripId]: "" }));
    const res = await fn();
    setPending((p) => ({ ...p, [tripId]: null }));
    setConfirmArm((c) => ({ ...c, [tripId]: null }));
    if (!res.ok) {
      setErrors((e) => ({ ...e, [tripId]: errorLabel(res.error) }));
      return;
    }
    await load();
    await loadBookings(tripId);
  };

  /* ── Feuille de publication ─────────────────────────────────────────── */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fromW, setFromW] = useState("16");
  const [toW, setToW] = useState("06");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [depAt, setDepAt] = useState("");
  const [seats, setSeats] = useState(4);
  const [price, setPrice] = useState(1000);
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [pubPending, setPubPending] = useState(false);
  const [pubError, setPubError] = useState("");
  const km = wilayaKm(fromW, toW);

  const publish = async () => {
    if (pubPending) return;
    setPubError("");
    if (!depAt) {
      setPubError(
        tr(
          "Choisissez la date et l'heure de départ.",
          "اختر تاريخ ووقت الانطلاق."
        )
      );
      return;
    }
    setPubPending(true);
    const res = await carpoolPublish({
      fromWilaya: fromW,
      toWilaya: toW,
      fromText,
      toText,
      departureAtIso: new Date(depAt).toISOString(),
      seats,
      priceDa: price,
      femaleOnly,
    });
    setPubPending(false);
    if (!res.ok) {
      setPubError(errorLabel(res.error));
      return;
    }
    setSheetOpen(false);
    setFromText("");
    setToText("");
    setDepAt("");
    setLoading(true);
    await load();
  };

  const statusChip = (s: CarpoolTrip["status"]) =>
    s === "published"
      ? { label: tr("À venir", "قادمة"), bg: "#F1E9FC", color: VIOLET }
      : s === "started"
        ? {
            label: tr("En route", "في الطريق"),
            bg: "rgba(22,179,100,.12)",
            color: GO,
          }
        : s === "completed"
          ? {
              label: tr("Terminé", "منتهية"),
              bg: "var(--d-soft)",
              color: "var(--d-muted)",
            }
          : {
              label: tr("Annulé", "ملغاة"),
              bg: "rgba(239,68,68,.10)",
              color: RED,
            };

  const bkStatus = (s: string) =>
    s === "booked"
      ? tr("Réservé", "محجوز")
      : s === "boarded"
        ? tr("À bord", "على متن")
        : s === "completed"
          ? tr("Terminé", "منتهٍ")
          : s === "no_show"
            ? tr("Absent", "غائب")
            : tr("Annulée", "ملغاة");

  return (
    <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
      <div className="flex items-center gap-2">
        <Link
          href="/chauffeur/interwilayas"
          aria-label={tr("Retour", "رجوع")}
          className="grid size-9 shrink-0 place-items-center rounded-[12px] border border-[var(--d-line)] bg-[var(--d-surface)]"
        >
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </Link>
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          {tr("Covoiturage", "مشاركة المشوار")}
        </h1>
      </div>
      <p className="mt-0.5 text-[11.5px] font-medium text-[var(--d-muted)]">
        {tr(
          "Publie un départ inter-wilayas et vends tes places.",
          "انشر رحلة بين الولايات وبِع مقاعدك."
        )}
      </p>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="drive-sora mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white"
        style={{ background: VIOLET, boxShadow: `0 12px 24px -10px ${VIOLET}` }}
      >
        <Plus className="size-5" /> {tr("Publier un départ", "نشر رحلة")}
      </button>

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="size-7 animate-spin" style={{ color: VIOLET }} />
        </div>
      )}

      {!loading && trips.length === 0 && (
        <div className="mt-4 rounded-[16px] border border-[var(--d-line)] p-4 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-full"
            style={{ background: "rgba(108,43,217,.10)" }}
          >
            <Route className="size-6" style={{ color: VIOLET }} />
          </span>
          <p className="drive-sora mt-2 text-[14px] font-extrabold">
            {tr("Aucun départ publié", "لا رحلات منشورة")}
          </p>
          <p className="mt-1 text-[12px] text-[var(--d-muted)]">
            {tr(
              "Exemple : Alger → Béjaïa, 4 places à 1 200 DA. Les clients réservent, tu pars plein.",
              "مثال: الجزائر ← بجاية، 4 مقاعد بـ 1200 دج. الزبائن يحجزون وتنطلق ممتلئًا."
            )}
          </p>
        </div>
      )}

      {trips.map((t) => {
        const chip = statusChip(t.status);
        const open = expanded === t.id;
        const bks = bookings[t.id] ?? [];
        const busy = pending[t.id];
        const arm = confirmArm[t.id];
        const routeLabel = `${wname(t.from_wilaya)} → ${wname(t.to_wilaya)}`;
        return (
          <div
            key={t.id}
            className="drive-rise mt-2.5 overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]"
          >
            <button
              type="button"
              onClick={() => toggleExpand(t.id)}
              className="flex w-full items-center gap-2.5 px-3.5 py-3 text-start"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-[11px]"
                style={{ background: "rgba(108,43,217,.10)" }}
              >
                <Route className="size-4" style={{ color: VIOLET }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="drive-sora flex flex-wrap items-center gap-1.5 text-[13px] font-extrabold">
                  {isAr
                    ? `${wname(t.from_wilaya)} ← ${wname(t.to_wilaya)}`
                    : routeLabel}
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                    style={{ background: chip.bg, color: chip.color }}
                  >
                    {chip.label}
                  </span>
                  {t.female_only && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                      style={{
                        background: "rgba(236,72,153,.13)",
                        color: ROSE,
                      }}
                    >
                      {tr("Femmes", "نساء")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--d-muted)]">
                  {fmtDate(t.departure_at)} · {t.distance_km} km
                </span>
              </span>
              <span className="shrink-0 text-end">
                <span className="drive-sora block text-[15px] font-extrabold">
                  {t.seats_booked}/{t.seats_total}
                  <Users className="ms-1 inline size-3.5 align-[-2px]" />
                </span>
                <span className="block text-[10px] font-semibold text-[var(--d-muted)]">
                  {t.price_per_seat_da} {tr("DA/place", "دج/مقعد")}
                </span>
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-[var(--d-muted)] transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>

            {open && (
              <div className="border-t border-[var(--d-line)] px-3.5 py-3">
                {(t.from_text || t.to_text) && (
                  <p className="mb-2 text-[11px] font-medium text-[var(--d-muted)]">
                    {t.from_text ?? wname(t.from_wilaya)} →{" "}
                    {t.to_text ?? wname(t.to_wilaya)}
                  </p>
                )}
                {/* Réservations */}
                {bks.length === 0 ? (
                  <p className="py-2 text-center text-[12px] text-[var(--d-muted)]">
                    {tr("Aucune réservation pour l'instant.", "لا حجوزات بعد.")}
                  </p>
                ) : (
                  bks.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 border-b border-[var(--d-line)] py-2 text-[12px] last:border-b-0"
                    >
                      <span
                        className="drive-sora grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white"
                        style={{
                          background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                        }}
                      >
                        {b.customer_name[0]?.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 font-semibold">
                        {b.customer_name}
                        <span className="ms-1 text-[10px] font-medium text-[var(--d-muted)]">
                          · {b.seats} {tr("place(s)", "مقعد")} ·{" "}
                          {bkStatus(b.status)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold">
                        {b.payment_method === "cash" ? (
                          <Banknote
                            className="size-3.5"
                            style={{ color: GO }}
                          />
                        ) : (
                          <Wallet
                            className="size-3.5"
                            style={{ color: VIOLET }}
                          />
                        )}
                        {b.amount_da} {tr("DA", "دج")}
                      </span>
                    </div>
                  ))
                )}

                {/* Embarquement PIN (départ pas encore clôturé) */}
                {(t.status === "published" || t.status === "started") &&
                  bks.some((b) => b.status === "booked") && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        inputMode="numeric"
                        maxLength={4}
                        value={pinInput[t.id] ?? ""}
                        onChange={(e) =>
                          setPinInput((p) => ({
                            ...p,
                            [t.id]: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        placeholder={tr("PIN passager", "PIN الراكب")}
                        className="drive-sora h-10 w-28 rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-center text-[15px] font-extrabold tracking-[3px] outline-none"
                      />
                      <button
                        type="button"
                        disabled={
                          (pinInput[t.id] ?? "").length !== 4 ||
                          busy === "board"
                        }
                        onClick={() =>
                          void run(t.id, "board", async () => {
                            const r = await carpoolBoard(
                              t.id,
                              pinInput[t.id] ?? ""
                            );
                            if (r.ok)
                              setPinInput((p) => ({ ...p, [t.id]: "" }));
                            return r;
                          })
                        }
                        className="drive-sora flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-extrabold text-white disabled:opacity-50"
                        style={{ background: GO }}
                      >
                        {busy === "board" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        {tr("Embarquer", "صعود")}
                      </button>
                    </div>
                  )}

                {errors[t.id] && (
                  <p
                    className="mt-2 text-center text-[11px] font-bold"
                    style={{ color: RED }}
                  >
                    {errors[t.id]}
                  </p>
                )}

                {/* Actions de cycle de vie — confirmation en 2 taps */}
                {t.status === "published" && (
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() =>
                        arm === "start"
                          ? void run(t.id, "start", () => carpoolStart(t.id))
                          : setConfirmArm((c) => ({ ...c, [t.id]: "start" }))
                      }
                      className="drive-sora flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-[12px] text-[13.5px] font-extrabold text-white disabled:opacity-60"
                      style={{ background: arm === "start" ? "#0E9F6E" : GO }}
                    >
                      {busy === "start" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {arm === "start"
                        ? tr("Confirmer le départ ?", "تأكيد الانطلاق؟")
                        : tr("Démarrer", "انطلاق")}
                    </button>
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() =>
                        arm === "cancel"
                          ? void run(t.id, "cancel", () =>
                              carpoolCancelTrip(t.id, routeLabel)
                            )
                          : setConfirmArm((c) => ({ ...c, [t.id]: "cancel" }))
                      }
                      className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] border text-[12px] font-bold disabled:opacity-60"
                      style={{
                        borderColor: arm === "cancel" ? RED : "var(--d-line)",
                        color: arm === "cancel" ? RED : "var(--d-muted)",
                      }}
                    >
                      {busy === "cancel" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      {arm === "cancel"
                        ? tr("Sûr ?", "متأكد؟")
                        : tr("Annuler", "إلغاء")}
                    </button>
                  </div>
                )}
                {t.status === "started" && (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      arm === "done"
                        ? void run(t.id, "done", () => carpoolComplete(t.id))
                        : setConfirmArm((c) => ({ ...c, [t.id]: "done" }))
                    }
                    className="drive-sora mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] text-[13.5px] font-extrabold text-white disabled:opacity-60"
                    style={{ background: VIOLET }}
                  >
                    {busy === "done" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {arm === "done"
                      ? tr("Confirmer l'arrivée ?", "تأكيد الوصول؟")
                      : tr("Terminer le trajet", "إنهاء الرحلة")}
                  </button>
                )}
                {t.status === "completed" && t.revenue_da > 0 && (
                  <p
                    className="mt-2 text-center text-[12px] font-bold"
                    style={{ color: GO }}
                  >
                    {tr("Recette", "الإيراد")} : {t.revenue_da} {tr("DA", "دج")}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Feuille : publier un départ ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45">
          <div className="w-full max-w-md rounded-t-[24px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="drive-sora text-[16px] font-extrabold">
                {tr("Publier un départ", "نشر رحلة")}
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={tr("Fermer", "إغلاق")}
                className="grid size-8 place-items-center rounded-full bg-[var(--d-soft)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex gap-2">
              {(
                [
                  [tr("Départ", "الانطلاق"), fromW, setFromW],
                  [tr("Arrivée", "الوصول"), toW, setToW],
                ] as const
              ).map(([label, val, set]) => (
                <label key={label} className="min-w-0 flex-1">
                  <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                    {label}
                  </span>
                  <select
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className="h-11 w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-2.5 text-[13px] font-bold outline-none"
                  >
                    {WILAYAS.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} — {isAr ? w.name_ar : w.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {km != null && (
              <p className="mt-1 text-[11px] font-semibold text-[var(--d-muted)]">
                ≈ {km} km
                {fromW === toW
                  ? ` · ${tr("choisissez deux wilayas différentes", "اختر ولايتين مختلفتين")}`
                  : ""}
              </p>
            )}

            <input
              value={fromText}
              onChange={(e) => setFromText(e.target.value)}
              placeholder={tr(
                "Point de rendez-vous au départ (ex. Gare routière)",
                "نقطة الالتقاء عند الانطلاق (مثلًا محطة الحافلات)"
              )}
              className="mt-2 h-11 w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-[13px] font-semibold outline-none"
            />
            <input
              value={toText}
              onChange={(e) => setToText(e.target.value)}
              placeholder={tr(
                "Point d'arrivée (ex. Centre-ville)",
                "نقطة الوصول (مثلًا وسط المدينة)"
              )}
              className="mt-2 h-11 w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-[13px] font-semibold outline-none"
            />

            <label className="mt-2 block">
              <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                {tr("Date et heure de départ", "تاريخ ووقت الانطلاق")}
              </span>
              <input
                type="datetime-local"
                value={depAt}
                onChange={(e) => setDepAt(e.target.value)}
                className="h-11 w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-[13px] font-bold outline-none"
              />
            </label>

            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr("Places", "المقاعد")}
                </span>
                <div className="flex h-11 items-center rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)]">
                  <button
                    type="button"
                    onClick={() => setSeats((s) => Math.max(1, s - 1))}
                    className="drive-sora h-full w-10 text-[16px] font-extrabold"
                  >
                    −
                  </button>
                  <span className="drive-sora flex-1 text-center text-[15px] font-extrabold">
                    <Armchair className="me-1 inline size-4 align-[-2px]" />
                    {seats}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSeats((s) => Math.min(8, s + 1))}
                    className="drive-sora h-full w-10 text-[16px] font-extrabold"
                  >
                    +
                  </button>
                </div>
              </div>
              <label className="flex-1">
                <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr("Prix / place (DA)", "السعر/مقعد (دج)")}
                </span>
                <input
                  inputMode="numeric"
                  value={price}
                  onChange={(e) =>
                    setPrice(
                      Math.max(
                        0,
                        Number(e.target.value.replace(/\D/g, "")) || 0
                      )
                    )
                  }
                  className="drive-sora h-11 w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-center text-[15px] font-extrabold outline-none"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => setFemaleOnly((v) => !v)}
              className="mt-2.5 flex w-full items-center gap-2.5 rounded-[12px] border-[1.5px] px-3 py-2.5 text-start"
              style={{
                borderColor: femaleOnly ? ROSE : "var(--d-line)",
                background: femaleOnly ? "rgba(236,72,153,.07)" : "transparent",
              }}
            >
              <span
                className="grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px]"
                style={{
                  borderColor: femaleOnly ? ROSE : "var(--d-line)",
                  background: femaleOnly ? ROSE : "transparent",
                }}
              >
                {femaleOnly && <Check className="size-3.5 text-white" />}
              </span>
              <span className="text-[12px] font-bold">
                {tr("Départ 100 % femmes", "رحلة 100٪ نساء")}
                <span className="block text-[10px] font-medium text-[var(--d-muted)]">
                  {tr(
                    "Réservé aux conductrices vérifiées.",
                    "مخصص للسائقات الموثّقات."
                  )}
                </span>
              </span>
            </button>

            {pubError && (
              <p
                className="mt-2 text-center text-[11.5px] font-bold"
                style={{ color: RED }}
              >
                {pubError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void publish()}
              disabled={pubPending}
              className="drive-sora mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-60"
              style={{ background: VIOLET }}
            >
              {pubPending && <Loader2 className="size-5 animate-spin" />}
              {tr("Publier", "نشر")} ·{" "}
              {seats * price > 0 ? `${seats} × ${price} ${tr("DA", "دج")}` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
