"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";
import { DriverShell } from "@/components/driver/driver-shell";
import { getDeliveryHistory } from "@/app/(driver)/actions";

/**
 * Chargeur de l'historique livraisons via TanStack Query (cache persistant, clé
 * par livreur). La page serveur ne fait plus que l'auth ; le contenu est lu ici
 * côté client → affichage INSTANTANÉ depuis le cache au retour + revalidation
 * silencieuse, plus de re-téléchargement ni de squelette plein écran à chaque
 * visite. Squelette uniquement au 1er chargement (cache vide).
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
        style={{ background: "var(--soft)" }}
      />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-8 w-24 animate-pulse rounded-full"
            style={{ background: "var(--soft)" }}
          />
        ))}
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[74px] animate-pulse rounded-[16px] border"
            style={{ background: "var(--surface)", borderColor: "var(--line)" }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Écran HISTORIQUE reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages :
 * .head + pills (Toutes / Livrées / Annulées avec compteurs) + groupes par jour
 * (.daygrp) + cartes .hcard (rail commerçant→client, heure, tag Espèces/Prépayé,
 * gain, badge statut). Données 100 % réelles.
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
function dayKey(d: Date) {
  // Clé jour stable (Alger) → pas de mismatch d'hydratation (#418).
  return d.toLocaleDateString("fr-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function dayLabel(d: Date, isAr: boolean) {
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(today)) return isAr ? "اليوم" : "Aujourd'hui";
  if (dayKey(d) === dayKey(yest)) return isAr ? "أمس" : "Hier";
  return d.toLocaleDateString(isAr ? "ar-DZ" : "fr-FR", {
    day: "2-digit",
    month: "long",
    timeZone: TZ,
  });
}
function hhmm(d: Date) {
  return d.toLocaleTimeString("fr-FR", {
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

  // Groupes par jour (ordre déjà décroissant en entrée).
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Row[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of filtered) {
      const d = new Date(r.delivery_delivered_at ?? r.created_at);
      const k = dayKey(d);
      if (!idx.has(k)) {
        idx.set(k, out.length);
        out.push({ key: k, label: dayLabel(d, isAr), items: [] });
      }
      out[idx.get(k)!].items.push(r);
    }
    return out;
  }, [filtered, isAr]);

  return (
    <>
      <div className="head">
        <h1>{tr("Historique", "السجل")}</h1>
        <div className="ic">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
        </div>
      </div>

      <div className="pills">
        <button
          type="button"
          className={"pill" + (filter === "all" ? " on" : "")}
          onClick={() => setFilter("all")}
        >
          {tr("Toutes", "الكل")} · {counts.all}
        </button>
        <button
          type="button"
          className={"pill" + (filter === "delivered" ? " on" : "")}
          onClick={() => setFilter("delivered")}
        >
          {tr("Livrées", "مُسلَّمة")} · {counts.delivered}
        </button>
        <button
          type="button"
          className={"pill" + (filter === "cancelled" ? " on" : "")}
          onClick={() => setFilter("cancelled")}
        >
          {tr("Annulées", "مُلغاة")} · {counts.cancelled}
        </button>
      </div>

      {groups.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 2px" }}>
          {tr("Aucune course pour ce filtre.", "لا توجد توصيلات لهذا التصفية.")}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className="daygrp">{g.label}</div>
            {g.items.map((r) => {
              const date = new Date(r.delivery_delivered_at ?? r.created_at);
              const delivered = r.status === "completed";
              const cancelled = r.status === "cancelled";
              const gain = r.driver_net_da ?? r.delivery_fee_da ?? 0;
              return (
                <div className="hcard" key={r.id}>
                  <div className="rail">
                    <span className="d s" />
                    <span className="ln" />
                    <span className="d e" />
                  </div>
                  <div className="mid">
                    <div className="nm">{merchantNameOf(r.merchant_id)}</div>
                    <div className="nm">
                      {r.delivery_address_text ??
                        tr("Adresse client", "عنوان الزبون")}
                    </div>
                    <div className="meta">
                      <span>{hhmm(date)}</span>·
                      <span className="tg">
                        {r.payment_method === "cash"
                          ? tr("Espèces", "نقداً")
                          : tr("Prépayé", "مدفوع مسبقاً")}
                      </span>
                      ·
                      <button
                        type="button"
                        onClick={() =>
                          openSupportChat({
                            orderRef: r.order_number,
                            attributes: {
                              Boutique: merchantNameOf(r.merchant_id),
                              Statut: delivered
                                ? "Livrée"
                                : cancelled
                                  ? "Annulée"
                                  : "En cours",
                            },
                          })
                        }
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          color: "var(--primary, #6C2BD9)",
                          fontWeight: 700,
                        }}
                      >
                        <LifeBuoy style={{ width: 12, height: 12 }} />
                        {tr("Aide", "مساعدة")}
                      </button>
                    </div>
                  </div>
                  <div className="right">
                    <span
                      className="amt"
                      style={delivered ? undefined : { color: "var(--muted)" }}
                    >
                      {delivered ? `+${grp(gain)} DA` : "—"}
                    </span>
                    <span
                      className={
                        "badge " + (cancelled ? "ko" : delivered ? "ok" : "")
                      }
                      style={
                        delivered || cancelled
                          ? undefined
                          : {
                              background: "var(--soft)",
                              color: "var(--muted)",
                            }
                      }
                    >
                      {delivered
                        ? tr("Livrée", "مُسلَّمة")
                        : cancelled
                          ? tr("Annulée", "مُلغاة")
                          : tr("En cours", "جارية")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
