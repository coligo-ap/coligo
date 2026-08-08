"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bike, ChevronDown, LifeBuoy, Search, Zap } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";
import { DriverShell } from "@/components/driver/driver-shell";
import { MoneyTabs } from "@/components/shared/money-tabs";
import { getDeliveryHistory } from "@/app/(driver)/actions";
import { BRAND_GO, BRAND_RED, SORA } from "@/components/shared/partner-ui";

/**
 * Chargeur de l'historique livraisons via TanStack Query (cache persistant, clé
 * par livreur). La page serveur ne fait plus que l'auth ; le contenu est lu ici
 * côté client → affichage INSTANTANÉ depuis le cache au retour + revalidation
 * silencieuse. Squelette uniquement au 1er chargement (cache vide).
 *
 * Sécurité : cache en mémoire de l'onglet, clé incluant le driverId, action
 * serveur ré-authentifiée (getCurrentDriver + RLS) → aucune fuite entre comptes.
 */
export function DeliveryHistoryLoader({
  driverId,
  driverFirstName,
}: {
  driverId: string;
  driverFirstName?: string;
}) {
  const { data, isPending } = useQuery({
    queryKey: ["driver-delivery-history", driverId],
    queryFn: () => getDeliveryHistory(),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return (
    <DriverShell driverFirstName={driverFirstName}>
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page. */}
      <MoneyTabs base="/driver" />
      {isPending && !data ? (
        <DeliveryHistorySkeleton />
      ) : (
        <DeliveryHistory
          rows={data?.rows ?? []}
          merchants={data?.merchants ?? []}
        />
      )}
    </DriverShell>
  );
}

/** Squelette de l'historique livraisons (1er chargement, cache vide). */
function DeliveryHistorySkeleton() {
  return (
    <div className="space-y-3">
      <div
        className="rounded-card-lg h-11 animate-pulse"
        style={{ background: "var(--d-soft)" }}
      />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-8 w-24 animate-pulse rounded-full"
            style={{ background: "var(--d-soft)" }}
          />
        ))}
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card-xl h-[64px] animate-pulse border"
            style={{
              background: "var(--d-surface)",
              borderColor: "var(--d-line)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * HISTORIQUE livreur — lignes COMPACTES (trajet · date · paiement · montant ·
 * badge) qui se DÉPLIENT au tap (adresses, horaires, durée, détail financier,
 * aide) : beaucoup plus d'informations sans submerger l'écran. Accordéon par
 * mois conservé (mois le plus récent ouvert), recherche texte (accents
 * ignorés) + filtres statut / paiement / type de course.
 * Données 100 % réelles, heures en fuseau Alger (anti-hydratation #418).
 */

type Row = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
  driver_net_da: number | null;
  payment_method: "cash" | "online";
  delivery_mode: "express" | "tour" | null;
  status: string;
  delivery_address_text: string | null;
  delivery_delivered_at: string | null;
  delivery_picked_up_at: string | null;
  created_at: string;
  merchant_id: string;
  validated_without_code: boolean;
};

type Merchant = { id: string; name: string };
type Filter = "all" | "delivered" | "cancelled";
type PayFilter = "all" | "cash" | "online";
type ModeFilter = "all" | "express" | "tour";

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const TZ = "Africa/Algiers";
const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MONTHS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function fmtDateTime(d: Date, isAr: boolean) {
  const date = d.toLocaleDateString(isAr ? "ar-DZ" : "fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
  return `${date} ${time}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function DeliveryHistory({
  rows,
  merchants,
}: {
  rows: Row[];
  merchants: Merchant[];
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const merchantNameOf = useMemo(() => {
    const map = new Map(merchants.map((m) => [m.id, m.name]));
    return (id: string) => map.get(id) ?? (isAr ? "تاجر" : "Commerçant");
  }, [merchants, isAr]);

  const [filter, setFilter] = useState<Filter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [q, setQ] = useState("");
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const defaultedRef = useRef(false);

  const counts = useMemo(
    () => ({
      all: rows.length,
      delivered: rows.filter((r) => r.status === "completed").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
    }),
    [rows]
  );

  const tokens = fold(q).split(/\s+/).filter(Boolean);
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "delivered" && r.status !== "completed") return false;
        if (filter === "cancelled" && r.status !== "cancelled") return false;
        if (pay !== "all" && r.payment_method !== pay) return false;
        if (mode !== "all" && r.delivery_mode !== mode) return false;
        if (tokens.length > 0) {
          const hay = fold(
            `${merchantNameOf(r.merchant_id)} ${r.delivery_address_text ?? ""} ${r.order_number ?? ""} ${r.customer_name ?? ""}`
          );
          if (!tokens.every((t) => hay.includes(t))) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filter, pay, mode, q, merchantNameOf]
  );

  // Regroupe PAR MOIS (parité chauffeur), ordre décroissant conservé.
  const months = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const d = new Date(r.delivery_delivered_at ?? r.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [filtered]);

  // Ouvre le mois le plus récent par défaut (une seule fois). Une recherche
  // active ouvre TOUS les mois (les résultats doivent être visibles).
  useEffect(() => {
    if (!defaultedRef.current && months.length > 0) {
      defaultedRef.current = true;
      setOpenMonths(new Set([months[0][0]]));
    }
  }, [months]);
  const searching = tokens.length > 0;

  const toggle = (key: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chip = (on: boolean) =>
    on
      ? { background: "var(--d-ink)", color: "var(--d-surface)" }
      : { background: "var(--d-soft)", color: "var(--d-muted)" };

  return (
    <>
      {/* Recherche (boutique, adresse, n° de commande, client). */}
      <div className="relative mb-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--d-muted)] rtl:right-3.5 rtl:left-auto" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr(
            "Rechercher une course (boutique, adresse, n°)…",
            "ابحث عن توصيلة (متجر، عنوان، رقم)…"
          )}
          className="rounded-card-lg text-body-sm h-11 w-full border border-[var(--d-line)] bg-[var(--d-surface)] ps-10 pe-3 text-[var(--d-ink)] outline-none placeholder:text-[var(--d-muted)]"
        />
      </div>

      {/* Filtres : statut · paiement · type — une seule rangée défilante. */}
      <div className="scrollbar-hide -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {(
          [
            ["all", tr("Toutes", "الكل"), counts.all],
            ["delivered", tr("Livrées", "مُسلَّمة"), counts.delivered],
            ["cancelled", tr("Annulées", "مُلغاة"), counts.cancelled],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className="text-label-lg shrink-0 rounded-full px-3.5 py-2 font-bold whitespace-nowrap transition-colors"
            style={chip(filter === key)}
          >
            {label} · {count}
          </button>
        ))}
        <span
          className="my-1 w-px shrink-0 self-stretch"
          style={{ background: "var(--d-line)" }}
        />
        {(
          [
            ["cash", tr("Espèces", "نقداً")],
            ["online", tr("Prépayé", "مدفوع مسبقاً")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPay(pay === key ? "all" : key)}
            className="text-label-lg shrink-0 rounded-full px-3.5 py-2 font-bold whitespace-nowrap transition-colors"
            style={chip(pay === key)}
          >
            {label}
          </button>
        ))}
        <span
          className="my-1 w-px shrink-0 self-stretch"
          style={{ background: "var(--d-line)" }}
        />
        {(
          [
            ["express", "Express"],
            ["tour", tr("Tournée", "جولة")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(mode === key ? "all" : key)}
            className="text-label-lg shrink-0 rounded-full px-3.5 py-2 font-bold whitespace-nowrap transition-colors"
            style={chip(mode === key)}
          >
            {label}
          </button>
        ))}
      </div>

      {months.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--d-muted)]">
          {tr(
            "Aucune course ne correspond à ces critères.",
            "لا توجد توصيلات مطابقة لهذه المعايير."
          )}
        </p>
      ) : (
        months.map(([key, items]) => {
          const d = new Date(
            items[0].delivery_delivered_at ?? items[0].created_at
          );
          const label = `${(isAr ? MONTHS_AR : MONTHS_FR)[d.getMonth()]} ${d.getFullYear()}`;
          const net = items.reduce(
            (s, r) =>
              s +
              (r.status === "completed"
                ? (r.driver_net_da ?? r.delivery_fee_da ?? 0)
                : 0),
            0
          );
          const open = searching || openMonths.has(key);
          return (
            <div key={key} className="mb-2.5">
              <button
                type="button"
                onClick={() => toggle(key)}
                className="rounded-card-lg flex w-full items-center gap-2 border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <b
                    className="text-body-lg block text-[var(--d-ink)] capitalize"
                    style={{ fontFamily: SORA }}
                  >
                    {label}
                  </b>
                  <small className="text-caption text-[var(--d-muted)]">
                    {items.length} {isAr ? "توصيلة" : "courses"} ·{" "}
                    {tr("net", "صافي")} +{grp(net)} {tr("DA", "دج")}
                  </small>
                </span>
                <ChevronDown
                  className="size-5 shrink-0 text-[var(--d-muted)] transition-transform"
                  style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
              </button>
              {open && (
                <div className="mt-2">
                  {items.map((r) => (
                    <HistoRow
                      key={r.id}
                      r={r}
                      merchantName={merchantNameOf(r.merchant_id)}
                      isAr={isAr}
                      open={openId === r.id}
                      onToggle={() =>
                        setOpenId((cur) => (cur === r.id ? null : r.id))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

/** Ligne label → valeur du panneau détail. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-label flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[var(--d-muted)]">{label}</span>
      <span className="min-w-0 text-right font-semibold text-[var(--d-ink)]">
        {value}
      </span>
    </div>
  );
}

/**
 * Une course : ligne COMPACTE (tap = déplier) + panneau détail (adresses,
 * horaires, durée, financier, aide) — le livreur scanne vite, ouvre au besoin.
 */
function HistoRow({
  r,
  merchantName,
  isAr,
  open,
  onToggle,
}: {
  r: Row;
  merchantName: string;
  isAr: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const delivered = r.status === "completed";
  const cancelled = r.status === "cancelled";
  const gain = r.driver_net_da ?? r.delivery_fee_da ?? 0;
  const date = new Date(r.delivery_delivered_at ?? r.created_at);
  const isExpress = r.delivery_mode !== "tour";

  // Durée récupération → livraison (minutes), si les deux horodatages existent.
  const durationMin =
    r.delivery_picked_up_at && r.delivery_delivered_at
      ? Math.max(
          1,
          Math.round(
            (Date.parse(r.delivery_delivered_at) -
              Date.parse(r.delivery_picked_up_at)) /
              60_000
          )
        )
      : null;

  return (
    <div className="rounded-card-xl mb-2 overflow-hidden border border-[var(--d-line)] bg-[var(--d-surface)]">
      {/* ── Ligne compacte ── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="rounded-control-lg grid size-[34px] shrink-0 place-items-center bg-[var(--d-soft)] text-[var(--d-ink)]">
          {isExpress ? <Zap className="size-4" /> : <Bike className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="text-body-sm block truncate text-[var(--d-ink)]">
            {merchantName} →{" "}
            {r.delivery_address_text ?? tr("Adresse client", "عنوان الزبون")}
          </b>
          <small className="text-caption block truncate text-[var(--d-muted)]">
            {fmtDateTime(date, isAr)} ·{" "}
            {r.payment_method === "cash"
              ? tr("Espèces", "نقداً")
              : tr("Prépayé", "مدفوع مسبقاً")}
          </small>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {delivered && (
            <b
              className="text-body-sm leading-none text-[var(--d-ink)]"
              style={{ fontFamily: SORA }}
            >
              +{grp(gain)} {tr("DA", "دج")}
            </b>
          )}
          <span
            className="text-micro rounded-full px-2 py-0.5 font-extrabold"
            style={
              delivered
                ? { background: "rgba(22,179,100,.12)", color: BRAND_GO }
                : cancelled
                  ? { background: "rgba(229,72,77,.12)", color: BRAND_RED }
                  : { background: "var(--d-soft)", color: "var(--d-muted)" }
            }
          >
            {delivered
              ? tr("Livrée", "مُسلَّمة")
              : cancelled
                ? tr("Annulée", "مُلغاة")
                : tr("En cours", "جارية")}
          </span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-[var(--d-muted)] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {/* ── Panneau détail (accordion) ── */}
      {open && (
        <div className="space-y-1.5 border-t border-[var(--d-line)] px-3.5 py-3">
          <DetailLine
            label={tr("Commande", "الطلب")}
            value={`${r.order_number ?? "—"} · ${isExpress ? "Express" : tr("Tournée", "جولة")}`}
          />
          <DetailLine label={tr("Boutique", "المتجر")} value={merchantName} />
          <DetailLine
            label={tr("Livraison", "التوصيل")}
            value={r.delivery_address_text ?? "—"}
          />
          {r.customer_name && (
            <DetailLine
              label={tr("Client", "الزبون")}
              value={r.customer_name}
            />
          )}
          <DetailLine
            label={tr("Horaires", "التوقيت")}
            value={`${tr("récupérée", "استلام")} ${fmtTime(r.delivery_picked_up_at)} · ${tr("livrée", "تسليم")} ${fmtTime(r.delivery_delivered_at)}${durationMin != null ? ` · ${durationMin} min` : ""}`}
          />
          <DetailLine
            label={tr("Total commande", "إجمالي الطلب")}
            value={`${grp(r.total_da ?? 0)} ${tr("DA", "دج")}`}
          />
          <DetailLine
            label={tr("Frais de livraison", "رسوم التوصيل")}
            value={`${grp(r.delivery_fee_da ?? 0)} ${tr("DA", "دج")}`}
          />
          {delivered && (
            <DetailLine
              label={tr("Mon gain net", "ربحي الصافي")}
              value={`+${grp(gain)} ${tr("DA", "دج")}`}
            />
          )}
          {r.validated_without_code && (
            <p
              className="text-caption font-semibold"
              style={{ color: BRAND_RED }}
            >
              {tr(
                "Livraison validée sans code client (déclaration).",
                "تم التسليم دون رمز الزبون (تصريح)."
              )}
            </p>
          )}
          <button
            type="button"
            onClick={() =>
              openSupportChat({
                orderRef: r.order_number,
                attributes: {
                  Boutique: merchantName,
                  Statut: delivered
                    ? "Livrée"
                    : cancelled
                      ? "Annulée"
                      : "En cours",
                },
              })
            }
            className="rounded-control text-label mt-1 inline-flex items-center gap-1.5 border border-[var(--d-line)] px-3 py-1.5 font-bold"
            style={{ color: "#6c2bd9" }}
          >
            <LifeBuoy className="size-3.5" />
            {tr("Aide sur cette course", "مساعدة بخصوص هذه التوصيلة")}
          </button>
        </div>
      )}
    </div>
  );
}
