"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bike, ChevronDown, LifeBuoy } from "lucide-react";
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
        className="h-7 w-44 animate-pulse rounded-lg"
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
            className="h-[74px] animate-pulse rounded-[15px] border"
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
 * HISTORIQUE livreur — MÊME maquette que « Mes courses » chauffeur (DHisto) :
 * accordéon PAR MOIS (mois le plus récent ouvert), lignes identiques (icône
 * carrée, trajet, méta date · montant, badge Livrée/Annulée). Les filtres de
 * statut (Toutes/Livrées/Annulées) sont conservés (fonctionnalité livreur).
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

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

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
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const defaultedRef = useRef(false);

  const counts = useMemo(
    () => ({
      all: rows.length,
      delivered: rows.filter((r) => r.status === "completed").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
    }),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        filter === "all"
          ? true
          : filter === "delivered"
            ? r.status === "completed"
            : r.status === "cancelled"
      ),
    [rows, filter]
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

  // Ouvre le mois le plus récent par défaut (une seule fois).
  useEffect(() => {
    if (!defaultedRef.current && months.length > 0) {
      defaultedRef.current = true;
      setOpenMonths(new Set([months[0][0]]));
    }
  }, [months]);

  const toggle = (key: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      {/* Filtres de statut (le titre vit dans les onglets du hub Argent). */}
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["all", tr("Toutes", "الكل"), counts.all],
            ["delivered", tr("Livrées", "مُسلَّمة"), counts.delivered],
            ["cancelled", tr("Annulées", "مُلغاة"), counts.cancelled],
          ] as const
        ).map(([key, label, count]) => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="rounded-full px-3.5 py-2 text-[12.5px] font-bold whitespace-nowrap transition-colors"
              style={
                on
                  ? { background: "var(--d-ink)", color: "var(--d-surface)" }
                  : { background: "var(--d-soft)", color: "var(--d-muted)" }
              }
            >
              {label} · {count}
            </button>
          );
        })}
      </div>

      {months.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--d-muted)]">
          {tr("Aucune course pour ce filtre.", "لا توجد توصيلات لهذا التصفية.")}
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
          const open = openMonths.has(key);
          return (
            <div key={key} className="mb-2.5">
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <b
                    className="block text-[14px] text-[var(--d-ink)] capitalize"
                    style={{ fontFamily: SORA }}
                  >
                    {label}
                  </b>
                  <small className="text-[11px] text-[var(--d-muted)]">
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

/** Une ligne de course (parité HistoRow chauffeur). */
function HistoRow({
  r,
  merchantName,
  isAr,
}: {
  r: Row;
  merchantName: string;
  isAr: boolean;
}) {
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const delivered = r.status === "completed";
  const cancelled = r.status === "cancelled";
  const gain = r.driver_net_da ?? r.delivery_fee_da ?? 0;
  const date = new Date(r.delivery_delivered_at ?? r.created_at);
  return (
    <div className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[var(--d-soft)] text-[var(--d-ink)]">
        <Bike className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px] text-[var(--d-ink)]">
          {merchantName} →{" "}
          {r.delivery_address_text ?? tr("Adresse client", "عنوان الزبون")}
        </b>
        <small className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--d-muted)]">
          {fmtDateTime(date, isAr)}
          {delivered && (
            <>
              {" "}
              · +{grp(gain)} {tr("DA", "دج")}
            </>
          )}{" "}
          ·{" "}
          {r.payment_method === "cash"
            ? tr("Espèces", "نقداً")
            : tr("Prépayé", "مدفوع مسبقاً")}
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
            className="inline-flex items-center gap-0.5 font-bold"
            style={{ color: "#6c2bd9" }}
          >
            <LifeBuoy className="size-3" />
            {tr("Aide", "مساعدة")}
          </button>
        </small>
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
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
    </div>
  );
}
