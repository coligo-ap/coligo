"use client";

import { useMemo, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";

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
function dayLabel(d: Date) {
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(today)) return "Aujourd'hui";
  if (dayKey(d) === dayKey(yest)) return "Hier";
  return d.toLocaleDateString("fr-FR", {
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
  const merchantNameOf = useMemo(() => {
    const map = new Map(merchants.map((m) => [m.id, m.name]));
    return (id: string) => map.get(id) ?? "Commerçant";
  }, [merchants]);

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
        out.push({ key: k, label: dayLabel(d), items: [] });
      }
      out[idx.get(k)!].items.push(r);
    }
    return out;
  }, [filtered]);

  return (
    <>
      <div className="head">
        <h1>Historique</h1>
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
          Toutes · {counts.all}
        </button>
        <button
          type="button"
          className={"pill" + (filter === "delivered" ? " on" : "")}
          onClick={() => setFilter("delivered")}
        >
          Livrées · {counts.delivered}
        </button>
        <button
          type="button"
          className={"pill" + (filter === "cancelled" ? " on" : "")}
          onClick={() => setFilter("cancelled")}
        >
          Annulées · {counts.cancelled}
        </button>
      </div>

      {groups.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 2px" }}>
          Aucune course pour ce filtre.
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
                      {r.delivery_address_text ?? "Adresse client"}
                    </div>
                    <div className="meta">
                      <span>{hhmm(date)}</span>·
                      <span className="tg">
                        {r.payment_method === "cash" ? "Espèces" : "Prépayé"}
                      </span>
                      ·
                      <button
                        type="button"
                        onClick={() =>
                          openSupportChat({ orderRef: r.order_number })
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
                        Aide
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
                        ? "Livrée"
                        : cancelled
                          ? "Annulée"
                          : "En cours"}
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
