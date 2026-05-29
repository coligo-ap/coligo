"use client";

import { useMemo, useState } from "react";
import { Check, MapPin, Search, XCircle } from "lucide-react";
import { formatDA } from "@/lib/utils";

type Row = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
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

type FilterMode = "all" | "express" | "tour";
type FilterStatus = "all" | "delivered" | "in_progress" | "cancelled";

/**
 * Historique livreur (style Uber) — liste filtrable par date, commerçant, mode
 * et statut, avec recherche libre. Refonte PUREMENT VISUELLE : la logique de
 * filtrage et les KPIs sont strictement identiques.
 */
export function DeliveryHistory({
  rows,
  merchants,
}: {
  rows: Row[];
  merchants: Merchant[];
}) {
  const merchantNameOf = useMemo(() => {
    const map = new Map(merchants.map((m) => [m.id, m.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [merchants]);

  const [q, setQ] = useState("");
  const [merchantId, setMerchantId] = useState<string>("all");
  const [mode, setMode] = useState<FilterMode>("all");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (merchantId !== "all" && r.merchant_id !== merchantId) return false;
      if (mode !== "all" && r.delivery_mode !== mode) return false;
      if (status === "delivered" && r.status !== "completed") return false;
      if (status === "cancelled" && r.status !== "cancelled") return false;
      if (
        status === "in_progress" &&
        (r.status === "completed" || r.status === "cancelled")
      )
        return false;
      const created = new Date(r.created_at);
      if (fromDate && created < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (created > end) return false;
      }
      if (search) {
        const hay = [
          r.customer_name ?? "",
          r.delivery_address_text ?? "",
          merchantNameOf(r.merchant_id),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [rows, q, merchantId, mode, status, fromDate, toDate, merchantNameOf]);

  // KPIs rapides sur la sélection filtrée.
  const totalDelivered = filtered.filter(
    (r) => r.status === "completed"
  ).length;
  const totalCashCollected = filtered
    .filter((r) => r.status === "completed" && r.payment_method === "cash")
    .reduce((s, r) => s + (r.total_da ?? 0), 0);
  const totalEarned = filtered
    .filter((r) => r.status === "completed")
    .reduce((s, r) => s + (r.delivery_fee_da ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-[9px]">
        <Stat label="Livrées" value={String(totalDelivered)} />
        <Stat label="Gagné" value={formatDA(totalEarned)} />
        <Stat label="Cash" value={formatDA(totalCashCollected)} />
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#9e9e9e]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Recherche client, adresse, commerçant…"
          className="w-full rounded-[12px] border-[1.5px] border-[#e5e5e5] bg-white py-3 pr-3 pl-10 text-sm font-medium text-[#0a0a0a] outline-none placeholder:text-[#9e9e9e] focus:border-[#0a0a0a]"
        />
      </div>

      {/* Filtres */}
      <div className="space-y-3 rounded-[14px] bg-white p-3.5 shadow-[0_2px_8px_rgba(0,0,0,.04)]">
        <div className="space-y-1.5">
          <FieldLabel>Commerçant</FieldLabel>
          <select
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className="w-full rounded-[10px] border-[1.5px] border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#0a0a0a] outline-none focus:border-[#0a0a0a]"
          >
            <option value="all">Tous ({merchants.length})</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Mode</FieldLabel>
          <div className="flex gap-1.5">
            <Pill active={mode === "all"} onClick={() => setMode("all")}>
              Tous
            </Pill>
            <Pill
              active={mode === "express"}
              onClick={() => setMode("express")}
            >
              Express
            </Pill>
            <Pill active={mode === "tour"} onClick={() => setMode("tour")}>
              Tournée
            </Pill>
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Statut</FieldLabel>
          <div className="flex gap-1.5">
            <Pill active={status === "all"} onClick={() => setStatus("all")}>
              Tous
            </Pill>
            <Pill
              active={status === "delivered"}
              onClick={() => setStatus("delivered")}
            >
              Livrées
            </Pill>
            <Pill
              active={status === "in_progress"}
              onClick={() => setStatus("in_progress")}
            >
              En cours
            </Pill>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <FieldLabel>Du</FieldLabel>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-[10px] border-[1.5px] border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#0a0a0a] outline-none focus:border-[#0a0a0a]"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Au</FieldLabel>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-[10px] border-[1.5px] border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#0a0a0a] outline-none focus:border-[#0a0a0a]"
            />
          </div>
        </div>
      </div>

      {/* Liste */}
      <p className="px-1 text-xs font-medium text-[#757575]">
        {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="px-1 text-sm text-[#757575]">
          Aucune livraison ne correspond à ces filtres.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <RowItem
              key={r.id}
              row={r}
              merchantName={merchantNameOf(r.merchant_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.3px] text-[#757575] uppercase">
      {children}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[13px] bg-white p-3 text-center shadow-[0_2px_8px_rgba(0,0,0,.04)]">
      <p className="text-[16px] font-extrabold text-[#0a0a0a] tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold tracking-wide text-[#757575] uppercase">
        {label}
      </p>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-full px-2 py-1.5 text-xs font-bold transition-colors " +
        (active ? "bg-black text-white" : "bg-[#f2f2f2] text-[#757575]")
      }
    >
      {children}
    </button>
  );
}

function RowItem({ row, merchantName }: { row: Row; merchantName: string }) {
  const isDelivered = row.status === "completed";
  const isCancelled = row.status === "cancelled";
  const date = row.delivery_delivered_at ?? row.created_at;
  return (
    <div className="space-y-2 rounded-[14px] bg-white p-3.5 shadow-[0_2px_8px_rgba(0,0,0,.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#0a0a0a]">
            {row.customer_name ?? "Client"}
          </p>
          <p className="text-xs font-medium text-[#757575]">{merchantName}</p>
        </div>
        <span
          className={
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold " +
            (isDelivered
              ? "bg-[#e6f6ef] text-[#00a86b]"
              : isCancelled
                ? "bg-[#fdeceb] text-[#e53935]"
                : "bg-[#fef3e0] text-[#b8740c]")
          }
        >
          {isDelivered ? (
            <Check className="size-3" />
          ) : isCancelled ? (
            <XCircle className="size-3" />
          ) : null}
          {isDelivered ? "Livrée" : isCancelled ? "Annulée" : "En cours"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.delivery_mode === "express" ? (
          <Chip>⚡ Express</Chip>
        ) : row.delivery_mode === "tour" ? (
          <Chip>📅 Tournée</Chip>
        ) : null}
        <Chip>
          {row.payment_method === "online" ? "💳 En ligne" : "💵 Cash"}
        </Chip>
        {row.validated_without_code && <Chip>Sans code</Chip>}
      </div>

      {row.delivery_address_text && (
        <p className="flex items-start gap-1.5 text-xs text-[#757575]">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          {row.delivery_address_text}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[#eee] pt-2 text-xs">
        <span className="font-medium text-[#9e9e9e] tabular-nums">
          {new Date(date).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="font-semibold text-[#0a0a0a] tabular-nums">
          {row.total_da != null ? formatDA(row.total_da) : "—"}
          {row.delivery_fee_da != null && (
            <span className="ml-1 font-medium text-[#757575]">
              · livr. {formatDA(row.delivery_fee_da)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f2f2f2] px-2.5 py-1 text-[10px] font-bold text-[#0a0a0a]">
      {children}
    </span>
  );
}
