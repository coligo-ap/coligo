"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  Banknote,
  Check,
  ChevronDown,
  ArrowUpDown,
  ClipboardList,
  Loader2,
  Phone,
  Plus,
  Route,
  Search,
  UsersRound,
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
import {
  ColigoCalendar,
  TimeSelect,
  dayLabel,
} from "@/components/shared/coligo-calendar";
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

type TabKey = "upcoming" | "ongoing" | "history";
const tabOf = (s: CarpoolTrip["status"]): TabKey =>
  s === "published" ? "upcoming" : s === "started" ? "ongoing" : "history";

/**
 * Écran COVOITURAGE chauffeur — LISTE calquée sur « Mes commandes » du client
 * (segmented control + recherche + chips bascule + cartes à badge vivant),
 * publication façon BlaBlaCar (communes libres, arrêts suggérés par le tracé,
 * prix par segment automatiques). FR/AR en dur (espace chauffeur).
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

  /* ── Filtrage façon « Mes commandes » : recherche + chips AVANT compteurs ── */
  const [query, setQuery] = useState("");
  const [fFemale, setFFemale] = useState(false);
  const [fStops, setFStops] = useState(false);

  const routeSearchText = useCallback(
    (t: CarpoolTrip) =>
      [
        t.from_text,
        t.to_text,
        ...t.route_texts,
        ...t.route_wilayas.map((w) => wname(w)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAr]
  );
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return trips.filter((t) => {
      if (fFemale && !t.female_only) return false;
      if (fStops && t.route_wilayas.length <= 2) return false;
      if (needle && !routeSearchText(t).includes(needle)) return false;
      return true;
    });
  }, [trips, query, fFemale, fStops, routeSearchText]);
  const counts = useMemo(() => {
    const c = { upcoming: 0, ongoing: 0, history: 0 };
    for (const t of scoped) c[tabOf(t.status)]++;
    return c;
  }, [scoped]);
  const [tab, setTab] = useState<TabKey>("upcoming");
  // Onglet par défaut une fois chargé : À venir s'il y en a, sinon En route,
  // sinon Historique (même logique que la page commandes).
  const [defaulted, setDefaulted] = useState(false);
  useEffect(() => {
    if (defaulted || loading) return;
    setDefaulted(true);
    if (trips.some((t) => tabOf(t.status) === "upcoming")) setTab("upcoming");
    else if (trips.some((t) => tabOf(t.status) === "ongoing"))
      setTab("ongoing");
    else setTab("history");
  }, [loading, trips, defaulted]);
  const filtered = scoped.filter((t) => tabOf(t.status) === tab);

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
      overlapping_trip: [
        "Ce créneau chevauche un autre de vos départs.",
        "هذا التوقيت يتداخل مع رحلة أخرى لك.",
      ],
      too_many_cancellations: [
        "Publication bloquée 30 jours : trop de départs annulés avec des passagers.",
        "النشر محظور 30 يومًا: إلغاءات كثيرة لرحلات بها ركاب.",
      ],
      price_too_high: [
        "Prix par place trop élevé pour cette distance.",
        "سعر المقعد مرتفع جدًا لهذه المسافة.",
      ],
      pin_locked: [
        "Trop d'essais — PIN verrouillé 10 minutes.",
        "محاولات كثيرة — PIN مقفل 10 دقائق.",
      ],
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
  // Date et heure SÉPARÉES (calendrier Coligo + sélecteur HH:MM) — plus de
  // datetime-local illisible.
  const [depDate, setDepDate] = useState<string | null>(null);
  const [depH, setDepH] = useState("08");
  const [depM, setDepM] = useState("00");
  const [calOpen, setCalOpen] = useState(true);
  // RETOUR programmé (itinéraire inversé, publié en même temps).
  const [retOn, setRetOn] = useState(false);
  const [retDate, setRetDate] = useState<string | null>(null);
  const [retH, setRetH] = useState("18");
  const [retM, setRetM] = useState("00");
  const [retCalOpen, setRetCalOpen] = useState(true);
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
    if (!depDate) {
      setPubError(
        tr(
          "Choisissez la date de départ dans le calendrier.",
          "اختر تاريخ الانطلاق من التقويم."
        )
      );
      return;
    }
    const depIso = new Date(`${depDate}T${depH}:${depM}:00`).toISOString();
    let retIso: string | null = null;
    if (retOn) {
      if (!retDate) {
        setPubError(
          tr("Choisissez la date du retour.", "اختر تاريخ رحلة العودة.")
        );
        return;
      }
      retIso = new Date(`${retDate}T${retH}:${retM}:00`).toISOString();
      // Le retour doit laisser le temps de faire l'aller (durée + 1 h).
      const minGapMs = (Math.round((totalKm / 70) * 60) + 60) * 60000;
      if (new Date(retIso).getTime() < new Date(depIso).getTime() + minGapMs) {
        setPubError(
          tr(
            "Le retour est trop tôt — laissez le temps de faire l'aller.",
            "رحلة العودة مبكرة جدًا — اترك وقتًا لإكمال الذهاب."
          )
        );
        return;
      }
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
      departureAtIso: depIso,
      returnDepartureAtIso: retIso,
      seats,
      priceDa: price,
      femaleOnly,
    });
    setPubPending(false);
    if (!res.ok) {
      setPubError(errorLabel(res.error));
      return;
    }
    if (res.returnError) {
      // Aller publié, retour refusé : on le dit clairement, la feuille reste
      // ouverte pour corriger l'heure du retour.
      setPubError(
        tr(
          "Aller publié ✓ — retour refusé : ",
          "نُشر الذهاب ✓ — رُفضت العودة: "
        ) + errorLabel(res.returnError)
      );
      setLoading(true);
      await load();
      return;
    }
    setSheetOpen(false);
    setFromPick(null);
    setToPick(null);
    setDepDate(null);
    setRetOn(false);
    setRetDate(null);
    setStopsOn(new Set());
    setLoading(true);
    await load();
  };

  /** Republier : feuille préremplie depuis un départ passé. */
  const republish = (t: CarpoolTrip) => {
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

  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: "upcoming", label: tr("À venir", "قادمة"), n: counts.upcoming },
    { key: "ongoing", label: tr("En route", "في الطريق"), n: counts.ongoing },
    { key: "history", label: tr("Historique", "السجل"), n: counts.history },
  ];

  return (
    <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
      {/* Page de PREMIER NIVEAU (onglet « Covoit. » de la nav). */}
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
        className="drive-sora mt-3 flex h-[48px] w-full items-center justify-center gap-2 rounded-[10px] text-[14.5px] font-extrabold text-white"
        style={{ background: VIOLET }}
      >
        <Plus className="size-5" /> {tr("Publier un départ", "نشر رحلة")}
      </button>

      {/* Segmented control — MÊME patron que « Mes commandes » client. */}
      <div className="mt-3 flex gap-1 rounded-full bg-[var(--d-soft)] p-1">
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className="drive-sora flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-bold transition"
              style={
                active
                  ? { background: "var(--d-surface)", color: VIOLET }
                  : { color: "var(--d-muted)" }
              }
            >
              {tb.label}
              <span
                className="rounded-full px-1.5 text-[10.5px] font-bold tabular-nums"
                style={
                  active
                    ? { background: "#F1E9FC", color: VIOLET }
                    : { background: "var(--d-line)", color: "var(--d-muted)" }
                }
              >
                {tb.n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Recherche + chips BASCULE (aucune active = tout) — zéro serveur. */}
      <div className="mt-2.5 space-y-2">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--d-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr(
              "Ville, commune, destination…",
              "مدينة، بلدية، وجهة…"
            )}
            className="h-11 w-full rounded-[10px] border border-[var(--d-line)] bg-[var(--d-surface)] ps-9 pe-10 text-[13px] font-semibold outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="✕"
              onClick={() => setQuery("")}
              className="absolute end-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-[var(--d-muted)]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              [
                fFemale,
                setFFemale,
                ROSE,
                tr("100 % femmes", "100٪ نساء"),
              ] as const,
              [
                fStops,
                setFStops,
                GO,
                tr("Avec arrêts", "برحلات توقف"),
              ] as const,
            ] as const
          ).map(([active, set, color, label], i) => (
            <button
              key={i}
              type="button"
              onClick={() => set(!active)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors"
              style={
                active
                  ? {
                      borderColor: color,
                      color,
                      background: "var(--d-surface)",
                    }
                  : {
                      borderColor: "var(--d-line)",
                      color: "var(--d-muted)",
                    }
              }
            >
              {i === 0 ? (
                <UsersRound className="size-3.5" />
              ) : (
                <Route className="size-3.5" />
              )}
              {label}
              {active && <X className="size-3" />}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="size-7 animate-spin" style={{ color: VIOLET }} />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="mt-3 rounded-[10px] border border-[var(--d-line)] p-8 text-center text-[12.5px] text-[var(--d-muted)]">
          <ClipboardList className="mx-auto mb-2 size-7 opacity-60" />
          {tab === "upcoming"
            ? tr(
                "Aucun départ à venir. Publie ton premier trajet — exemple : Béjaïa → Alger avec arrêt à Bouira, et pars plein.",
                "لا رحلات قادمة. انشر رحلتك الأولى — مثال: بجاية ← الجزائر مع توقف في البويرة، وانطلق ممتلئًا."
              )
            : tab === "ongoing"
              ? tr("Aucun départ en route.", "لا رحلات في الطريق.")
              : tr("Aucun départ dans l'historique.", "لا رحلات في السجل.")}
        </div>
      )}

      <ul className="mt-2.5 space-y-2.5">
        {filtered.map((t) => {
          const chip = statusChip(t.status);
          const open = expanded === t.id;
          const bks = bookings[t.id] ?? [];
          const busy = pending[t.id];
          const arm = confirmArm[t.id];
          const live = t.status === "published" || t.status === "started";
          const nStops = Math.max(0, t.route_wilayas.length - 2);
          const routeLabel = `${wname(t.from_wilaya)} → ${wname(t.to_wilaya)}`;
          return (
            <li
              key={t.id}
              className="overflow-hidden rounded-[12px] border bg-[var(--d-surface)]"
              style={
                // Départ VIVANT = carte mise en avant (même langage que les
                // commandes en cours côté client).
                live
                  ? {
                      borderColor: "rgba(108,43,217,.35)",
                      boxShadow: "0 0 0 2px rgba(108,43,217,.10)",
                    }
                  : { borderColor: "var(--d-line)" }
              }
            >
              <button
                type="button"
                onClick={() => toggleExpand(t.id)}
                className="flex w-full items-center gap-3 p-3 text-start"
              >
                <span
                  className="drive-sora grid size-12 shrink-0 place-items-center self-start rounded-full text-base font-bold"
                  style={{ background: "#F1E9FC", color: VIOLET }}
                >
                  <Route className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  {/* Ligne 1 : itinéraire + prix/place */}
                  <span className="flex items-center justify-between gap-2">
                    <span className="drive-sora line-clamp-1 text-[13.5px] font-extrabold">
                      {isAr
                        ? `${wname(t.from_wilaya)} ← ${wname(t.to_wilaya)}`
                        : routeLabel}
                    </span>
                    <span className="drive-sora shrink-0 text-[13.5px] font-extrabold tabular-nums">
                      {t.price_per_seat_da}{" "}
                      <span className="text-[10px] font-semibold text-[var(--d-muted)]">
                        {tr("DA/pl.", "دج/مق.")}
                      </span>
                    </span>
                  </span>
                  {/* Ligne 2 : badge vivant + date · places · arrêts */}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--d-muted)]">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-extrabold"
                      style={{ background: chip.bg, color: chip.color }}
                    >
                      {live && (
                        <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                      )}
                      {chip.label}
                    </span>
                    <span>{fmtDate(t.departure_at)}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <UsersRound className="size-3" />
                      {t.seats_booked}/{t.seats_total}
                    </span>
                    {nStops > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: GO }}
                        >
                          <Route className="size-3" />+{nStops}{" "}
                          {tr("arrêt", "توقف")}
                          {!isAr && nStops > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {t.female_only && (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-extrabold"
                        style={{
                          background: "rgba(236,72,153,.13)",
                          color: ROSE,
                        }}
                      >
                        {tr("Femmes", "نساء")}
                      </span>
                    )}
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
                    <span className="shrink-0 self-start text-[10.5px] font-bold text-[var(--d-muted)]">
                      {t.distance_km} km
                    </span>
                  </div>

                  {/* Réservations (avec le SEGMENT de chaque passager) */}
                  {bks.length === 0 ? (
                    <p className="py-2 text-center text-[12px] text-[var(--d-muted)]">
                      {tr(
                        "Aucune réservation pour l'instant.",
                        "لا حجوزات بعد."
                      )}
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
                        {/* Appel direct du passager (R8 : numéro présent
                            UNIQUEMENT sur une réservation vivante). */}
                        {b.customer_phone && (
                          <a
                            href={`tel:${b.customer_phone}`}
                            aria-label={tr("Appeler", "اتصال")}
                            className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-[var(--d-line)]"
                            style={{ color: GO }}
                          >
                            <Phone className="size-3.5" />
                          </a>
                        )}
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
                          className="drive-sora h-10 w-28 rounded-[8px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-center text-[15px] font-extrabold tracking-[3px] outline-none"
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
                          className="drive-sora flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-extrabold text-white disabled:opacity-50"
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
                        className="drive-sora flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-[10px] text-[13.5px] font-extrabold text-white disabled:opacity-60"
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
                        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border text-[12px] font-bold disabled:opacity-60"
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
                      className="drive-sora mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] text-[13.5px] font-extrabold text-white disabled:opacity-60"
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
                      {tr("Recette", "الإيراد")} : {t.revenue_da}{" "}
                      {tr("DA", "دج")}
                    </p>
                  )}
                  {/* REPUBLIER : un trajet régulier se relance en 2 taps. */}
                  {(t.status === "completed" || t.status === "cancelled") && (
                    <button
                      type="button"
                      onClick={() => republish(t)}
                      className="drive-sora mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[var(--d-line)] text-[12px] font-bold"
                      style={{ color: VIOLET }}
                    >
                      <Plus className="size-3.5" />
                      {tr("Republier ce trajet", "إعادة نشر هذه الرحلة")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── Feuille : publier un départ ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45">
          <div className="max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[16px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
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
            <div className="rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-1">
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
                  className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-[var(--d-line)] bg-[var(--d-surface)]"
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
                        className="drive-sora flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-bold"
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
              <div className="mt-3 rounded-[10px] bg-[var(--d-soft)] px-3.5 py-2.5">
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

            {/* DATE (calendrier Coligo) et HEURE séparées — compréhension
                immédiate, plus de datetime-local illisible. */}
            <div className="mt-3">
              <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                {tr("Date de départ", "تاريخ الانطلاق")}
              </span>
              <button
                type="button"
                onClick={() => setCalOpen((v) => !v)}
                className="drive-sora mb-1.5 flex h-11 w-full items-center justify-between rounded-[10px] border-[1.5px] px-3 text-[13.5px] font-extrabold"
                style={{
                  borderColor: depDate ? VIOLET : "var(--d-line)",
                  color: depDate ? VIOLET : "var(--d-muted)",
                }}
              >
                {depDate
                  ? dayLabel(depDate, isAr)
                  : tr("Choisir un jour…", "اختر يومًا…")}
                <ChevronDown
                  className={`size-4 transition-transform ${calOpen ? "rotate-180" : ""}`}
                />
              </button>
              {calOpen && (
                <ColigoCalendar
                  value={depDate}
                  onChange={(d) => {
                    setDepDate(d);
                    setCalOpen(false);
                  }}
                />
              )}
            </div>
            <div className="mt-2">
              <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                {tr("Heure de départ", "وقت الانطلاق")}
              </span>
              <TimeSelect
                hour={depH}
                minute={depM}
                onChange={(h, m) => {
                  setDepH(h);
                  setDepM(m);
                }}
              />
            </div>

            {/* RETOUR : publie aussi le trajet inverse (arrêts compris). */}
            <button
              type="button"
              onClick={() => {
                setRetOn((v) => !v);
                if (!retDate && depDate) setRetDate(depDate);
              }}
              className="mt-2.5 flex w-full items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 py-2.5 text-start"
              style={{
                borderColor: retOn ? GO : "var(--d-line)",
                background: retOn ? "rgba(22,179,100,.06)" : "transparent",
              }}
            >
              <span
                className="grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px]"
                style={{
                  borderColor: retOn ? GO : "var(--d-line)",
                  background: retOn ? GO : "transparent",
                }}
              >
                {retOn && <Check className="size-3.5 text-white" />}
              </span>
              <span className="text-[12px] font-bold">
                {tr("Programmer aussi le retour", "برمجة رحلة العودة أيضًا")}
                <span className="block text-[10px] font-medium text-[var(--d-muted)]">
                  {tr(
                    "Le trajet inverse (arrêts compris) est publié en même temps.",
                    "يُنشر المسار العكسي (مع المحطات) في الوقت نفسه."
                  )}
                </span>
              </span>
            </button>
            {retOn && (
              <div className="mt-2 rounded-[10px] border border-[var(--d-line)] p-2.5">
                <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr("Date du retour", "تاريخ العودة")}
                </span>
                <button
                  type="button"
                  onClick={() => setRetCalOpen((v) => !v)}
                  className="drive-sora mb-1.5 flex h-11 w-full items-center justify-between rounded-[10px] border-[1.5px] px-3 text-[13.5px] font-extrabold"
                  style={{
                    borderColor: retDate ? GO : "var(--d-line)",
                    color: retDate ? GO : "var(--d-muted)",
                  }}
                >
                  {retDate
                    ? dayLabel(retDate, isAr)
                    : tr("Choisir un jour…", "اختر يومًا…")}
                  <ChevronDown
                    className={`size-4 transition-transform ${retCalOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {retCalOpen && (
                  <ColigoCalendar
                    value={retDate}
                    onChange={(d) => {
                      setRetDate(d);
                      setRetCalOpen(false);
                    }}
                  />
                )}
                <span className="mt-2 mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr("Heure du retour", "وقت العودة")}
                </span>
                <TimeSelect
                  hour={retH}
                  minute={retM}
                  onChange={(h, m) => {
                    setRetH(h);
                    setRetM(m);
                  }}
                />
              </div>
            )}

            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                <span className="mb-1 block text-[10.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                  {tr("Places", "المقاعد")}
                </span>
                <div className="flex h-11 items-center rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)]">
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
                  className="drive-sora h-11 w-full rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-center text-[15px] font-extrabold outline-none"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => setFemaleOnly((v) => !v)}
              className="mt-2.5 flex w-full items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 py-2.5 text-start"
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
              className="drive-sora mt-3 flex h-[48px] w-full items-center justify-center gap-2 rounded-[10px] text-[14.5px] font-extrabold text-white disabled:opacity-60"
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
