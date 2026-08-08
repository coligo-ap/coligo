"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  UsersRound,
  ArrowUpDown,
  Banknote,
  Check,
  ChevronDown,
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
import { PlaceField, type PlacePick } from "@/components/shared/place-field";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { suggestCorridorStops } from "@/lib/drive/route-corridor";
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

/** Haversine (km) — même géométrie que le serveur (km cumulés des arrêts). */
function kmBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Prix d'un segment — MIROIR de carpool_segment_price (pas de 50, min 100). */
function segPrice(total: number, segKm: number, totKm: number): number {
  if (segKm >= totKm) return total;
  return Math.max(
    100,
    Math.min(total, Math.round((total * segKm) / Math.max(totKm, 1) / 50) * 50)
  );
}

/**
 * Écran COVOITURAGE chauffeur v2 — publication façon BlaBlaCar : départ et
 * arrivée au niveau COMMUNE (saisie libre + suggestions gazetteer), arrêts
 * intermédiaires SUGGÉRÉS automatiquement par le tracé routier (« Sur votre
 * route : Bouira »), prix par segment calculés tout seuls. Le chauffeur
 * remplit 4 champs, l'app fait le reste.
 */
export function DCarpool() {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const wname = (code: string | null) => {
    if (!code) return "—";
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
        "Choisissez un départ et une arrivée dans deux wilayas différentes.",
        "اختر انطلاقًا ووصولًا في ولايتين مختلفتين.",
      ],
      bad_stops: [
        "Arrêts invalides — réessayez avec les arrêts suggérés.",
        "محطات غير صالحة — أعد المحاولة بالمحطات المقترحة.",
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
        "Vérifiez les places et le prix (min 100 DA).",
        "تحقق من المقاعد والسعر (100 دج على الأقل).",
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

  /* ── Feuille de publication (BlaBlaCar en mode Coligo) ────────────────── */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fromPick, setFromPick] = useState<PlacePick | null>(null);
  const [toPick, setToPick] = useState<PlacePick | null>(null);
  const [depAt, setDepAt] = useState("");
  const [seats, setSeats] = useState(4);
  const [price, setPrice] = useState(1000);
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [pubPending, setPubPending] = useState(false);
  const [pubError, setPubError] = useState("");

  // ARRÊTS SUGGÉRÉS automatiquement : wilayas proches du tracé ROUTIER réel
  // (OSRM, repli segment droit). Le chauffeur active d'un tap.
  const fromPt = fromPick ? { lat: fromPick.lat, lng: fromPick.lng } : null;
  const toPt = toPick ? { lat: toPick.lat, lng: toPick.lng } : null;
  const roadPath = useRoadPath(sheetOpen ? fromPt : null, toPt, {
    retryMs: 5000,
  });
  const corridor = useMemo(
    () =>
      fromPick && toPick && fromPick.wilaya !== toPick.wilaya
        ? suggestCorridorStops(roadPath, fromPick, toPick)
        : [],
    [roadPath, fromPick, toPick]
  );
  const [stopsOn, setStopsOn] = useState<Set<string>>(new Set());
  useEffect(() => {
    setStopsOn(new Set());
  }, [fromPick?.wilaya, toPick?.wilaya]);
  const activeStops = corridor.filter((c) => stopsOn.has(c.code));

  // Chaîne de points → km cumulés → aperçu du prix de chaque segment.
  const chain = useMemo(() => {
    if (!fromPick || !toPick) return [];
    const pts = [
      {
        w: fromPick.wilaya,
        lat: fromPick.lat,
        lng: fromPick.lng,
        label: fromPick.label,
      },
      ...activeStops.map((s) => ({
        w: s.code,
        lat: s.lat,
        lng: s.lng,
        label: wname(s.code),
      })),
      {
        w: toPick.wilaya,
        lat: toPick.lat,
        lng: toPick.lng,
        label: toPick.label,
      },
    ];
    let km = 0;
    return pts.map((p, i) => {
      if (i > 0) km += kmBetween(pts[i - 1].lat, pts[i - 1].lng, p.lat, p.lng);
      return { ...p, km: Math.round(km) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPick, toPick, activeStops, isAr]);
  const totalKm = chain.length ? chain[chain.length - 1].km : 0;

  const publish = async () => {
    if (pubPending) return;
    setPubError("");
    if (!fromPick || !toPick) {
      setPubError(
        tr(
          "Choisissez le départ et l'arrivée dans les suggestions.",
          "اختر الانطلاق والوصول من الاقتراحات."
        )
      );
      return;
    }
    if (fromPick.wilaya === toPick.wilaya) {
      setPubError(errorLabel("bad_route"));
      return;
    }
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
      fromWilaya: fromPick.wilaya,
      toWilaya: toPick.wilaya,
      fromText: fromPick.label,
      toText: toPick.label,
      fromLat: fromPick.lat,
      fromLng: fromPick.lng,
      toLat: toPick.lat,
      toLng: toPick.lng,
      stops: activeStops.map((s) => ({
        wilaya: s.code,
        lat: s.lat,
        lng: s.lng,
      })),
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
    setFromPick(null);
    setToPick(null);
    setDepAt("");
    setStopsOn(new Set());
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

  /** Libellé d'un arrêt de l'itinéraire (texte commune sinon nom wilaya). */
  const stopLabel = (t: CarpoolTrip, i: number) =>
    t.route_texts[i] || wname(t.route_wilayas[i] ?? null);

  return (
    <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
      {/* Page de PREMIER NIVEAU (onglet « Covoit. » de la nav) : pas de
          bouton retour — la nav du bas fait foi. */}
      <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
        {tr("Covoiturage", "مشاركة المشوار")}
      </h1>
      <p className="mt-0.5 text-[11.5px] font-medium text-[var(--d-muted)]">
        {tr(
          "Publie ton départ, ajoute des arrêts sur ta route, vends tes places.",
          "انشر رحلتك، أضف محطات على طريقك، وبِع مقاعدك."
        )}
      </p>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="drive-sora mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white"
        style={{ background: VIOLET }}
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
              "Exemple : Béjaïa → Alger avec arrêt à Bouira — tu prends aussi les passagers Bouira → Alger, et tu pars plein.",
              "مثال: بجاية ← الجزائر مع توقف في البويرة — تأخذ أيضًا ركاب البويرة ← الجزائر وتنطلق ممتلئًا."
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
        const nStops = Math.max(0, t.route_wilayas.length - 2);
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
                  {nStops > 0 && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                      style={{ background: "rgba(22,179,100,.12)", color: GO }}
                    >
                      +{nStops} {tr("arrêt", "توقف")}
                      {!isAr && nStops > 1 ? "s" : ""}
                    </span>
                  )}
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
                {/* Itinéraire complet — rail vertical avec chaque arrêt. */}
                <div className="mb-2.5 flex gap-2.5">
                  <div className="flex w-3 shrink-0 flex-col items-center pt-1 pb-1">
                    {t.route_wilayas.map((_, i) => (
                      <span key={i} className="contents">
                        {i > 0 && (
                          <span className="my-0.5 w-[2px] flex-1 rounded bg-[var(--d-line)]" />
                        )}
                        <span
                          className="size-[8px] shrink-0 rounded-full"
                          style={{
                            background:
                              i === 0
                                ? VIOLET
                                : i === t.route_wilayas.length - 1
                                  ? "var(--d-ink)"
                                  : GO,
                          }}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    {t.route_wilayas.map((w, i) => (
                      <p
                        key={`${w}-${i}`}
                        className="truncate py-0.5 text-[11.5px] font-semibold"
                        style={{
                          color:
                            i === 0 || i === t.route_wilayas.length - 1
                              ? "var(--d-ink)"
                              : "var(--d-muted)",
                        }}
                      >
                        {stopLabel(t, i)}
                      </p>
                    ))}
                  </div>
                </div>

                {/* Réservations (avec le SEGMENT de chaque passager) */}
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
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {b.customer_name}
                          <span className="ms-1 text-[10px] font-medium text-[var(--d-muted)]">
                            · {b.seats} {tr("pl.", "مق.")} ·{" "}
                            {bkStatus(b.status)}
                          </span>
                        </span>
                        <span className="block truncate text-[10px] font-medium text-[var(--d-muted)]">
                          {(b.seg_from_text ?? wname(b.seg_from_wilaya)) +
                            " → " +
                            (b.seg_to_text ?? wname(b.seg_to_wilaya))}
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
                {/* REPUBLIER : un trajet régulier se relance en 2 taps — la
                    feuille s'ouvre préremplie (itinéraire, prix, places). */}
                {(t.status === "completed" || t.status === "cancelled") && (
                  <button
                    type="button"
                    onClick={() => {
                      const cf = WILAYA_CENTROIDS[t.from_wilaya];
                      const ct = WILAYA_CENTROIDS[t.to_wilaya];
                      if (cf)
                        setFromPick({
                          label: t.from_text ?? wname(t.from_wilaya),
                          secondary: null,
                          lat: cf.lat,
                          lng: cf.lng,
                          wilaya: t.from_wilaya,
                        });
                      if (ct)
                        setToPick({
                          label: t.to_text ?? wname(t.to_wilaya),
                          secondary: null,
                          lat: ct.lat,
                          lng: ct.lng,
                          wilaya: t.to_wilaya,
                        });
                      setSeats(t.seats_total);
                      setPrice(t.price_per_seat_da);
                      setFemaleOnly(t.female_only);
                      setSheetOpen(true);
                    }}
                    className="drive-sora mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[12px] font-bold"
                    style={{ color: VIOLET }}
                  >
                    <Plus className="size-3.5" />
                    {tr("Republier ce trajet", "إعادة نشر هذه الرحلة")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Feuille : publier un départ ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45">
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
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

            {/* Départ / Arrivée — COMMUNE en saisie libre + suggestions. */}
            <div className="rounded-[16px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="border-b border-[var(--d-line)]">
                    <PlaceField
                      value={fromPick}
                      onChange={setFromPick}
                      placeholder={tr(
                        "Départ — commune, ville, lieu…",
                        "الانطلاق — بلدية، مدينة، مكان…"
                      )}
                      marker="origin"
                    />
                  </div>
                  <PlaceField
                    value={toPick}
                    onChange={setToPick}
                    placeholder={tr(
                      "Arrivée — commune, ville, lieu…",
                      "الوصول — بلدية، مدينة، مكان…"
                    )}
                    bias={
                      fromPick ? { lat: fromPick.lat, lng: fromPick.lng } : null
                    }
                    marker="dest"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const f = fromPick;
                    setFromPick(toPick);
                    setToPick(f);
                  }}
                  aria-label={tr("Inverser", "عكس")}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-sm"
                  style={{ color: VIOLET }}
                >
                  <ArrowUpDown className="size-4" />
                </button>
              </div>
            </div>

            {/* Arrêts SUGGÉRÉS par le tracé — l'app détecte, le chauffeur tape. */}
            {corridor.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr(
                    "Sur votre route — prendre / déposer à",
                    "على طريقك — صعود / نزول في"
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {corridor.map((s) => {
                    const on = stopsOn.has(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() =>
                          setStopsOn((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.code)) next.delete(s.code);
                            else next.add(s.code);
                            return next;
                          })
                        }
                        className="drive-sora flex h-8 items-center gap-1 rounded-[14px] border px-3 text-[11px] font-bold"
                        style={
                          on
                            ? {
                                background: "rgba(22,179,100,.12)",
                                color: GO,
                                borderColor: "rgba(22,179,100,.30)",
                              }
                            : {
                                borderColor: "var(--d-line)",
                                color: "var(--d-muted)",
                              }
                        }
                      >
                        {on ? (
                          <Check className="size-3" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                        {wname(s.code)}
                        <span className="text-[9px] font-semibold opacity-70">
                          {s.offKm <= 5
                            ? tr("sur la route", "على الطريق")
                            : `${s.offKm} km`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Aperçu de l'itinéraire + prix PAR SEGMENT (auto). */}
            {chain.length >= 2 && (
              <div className="mt-3 rounded-[14px] bg-[var(--d-soft)] px-3.5 py-2.5">
                <p className="text-[11px] font-bold">
                  {chain.map((p) => p.label.split(",")[0]).join(" → ")}{" "}
                  <span className="font-semibold text-[var(--d-muted)]">
                    · ≈ {totalKm} km
                  </span>
                </p>
                {chain.length > 2 && (
                  <div className="mt-1 space-y-0.5">
                    {chain.slice(0, -1).map((p, i) => {
                      const next = chain[i + 1];
                      const sp = segPrice(price, next.km - p.km, totalKm);
                      return (
                        <p
                          key={`${p.w}-${i}`}
                          className="text-[10.5px] font-semibold text-[var(--d-muted)]"
                        >
                          {p.label.split(",")[0]} → {next.label.split(",")[0]} ·{" "}
                          <b className="text-[var(--d-ink)]">
                            ≈ {sp} {tr("DA/place", "دج/مقعد")}
                          </b>
                        </p>
                      );
                    })}
                    <p className="text-[9.5px] font-medium text-[var(--d-muted)]">
                      {tr(
                        "Prix des tronçons calculés automatiquement (au prorata des km).",
                        "أسعار المقاطع تُحسب تلقائيًا (بحسب الكيلومترات)."
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}

            <label className="mt-3 block">
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
                    <UsersRound className="me-1 inline size-4 align-[-2px]" />
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
                  {tr(
                    "Prix / place — trajet complet",
                    "السعر/مقعد — كامل الرحلة"
                  )}
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
