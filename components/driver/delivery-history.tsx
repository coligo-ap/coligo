"use client";

import { useMemo, useState } from "react";
import {
  Banknote,
  Bolt,
  Calendar,
  Check,
  CreditCard,
  MapPin,
  Search,
  XCircle,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
 * Historique livreur — liste filtrable par date, commerçant, mode et statut,
 * avec recherche libre sur le client / l'adresse.
 */
export function DeliveryHistory({
  rows,
  merchants,
}: {
  rows: Row[];
  merchants: Merchant[];
}) {
  // Lookup nom commerçant construit côté client : on ne peut pas recevoir une
  // fonction depuis un Server Component (interdit par React).
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
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Livrées" value={String(totalDelivered)} />
        <Stat label="Gagné" value={formatDA(totalEarned)} />
        <Stat label="Cash" value={formatDA(totalCashCollected)} />
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search className="text-subtle absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Recherche client, adresse, commerçant…"
          className="pl-9"
        />
      </div>

      {/* Filtres */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="merchant_filter" className="text-xs">
            Commerçant
          </Label>
          <select
            id="merchant_filter"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className="border-border bg-surface w-full rounded-[10px] border px-3 py-2 text-sm"
          >
            <option value="all">Tous ({merchants.length})</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Mode</Label>
          <div className="flex gap-1">
            <ModeBtn cur={mode} set={setMode} value="all" label="Tous" />
            <ModeBtn cur={mode} set={setMode} value="express" label="Express" />
            <ModeBtn cur={mode} set={setMode} value="tour" label="Tournée" />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Statut</Label>
          <div className="flex gap-1">
            <StatusBtn cur={status} set={setStatus} value="all" label="Tous" />
            <StatusBtn
              cur={status}
              set={setStatus}
              value="delivered"
              label="Livrées"
            />
            <StatusBtn
              cur={status}
              set={setStatus}
              value="in_progress"
              label="En cours"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="from_date" className="text-xs">
              Du
            </Label>
            <Input
              id="from_date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to_date" className="text-xs">
              Au
            </Label>
            <Input
              id="to_date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Liste */}
      <p className="text-muted text-xs">
        {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm">
          Aucune livraison ne correspond à ces filtres.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <RowItem
              key={r.id}
              row={r}
              merchantName={merchantNameOf(r.merchant_id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border-border rounded-[10px] border p-2 text-center">
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-muted text-[10px] tracking-wide uppercase">{label}</p>
    </div>
  );
}

function ModeBtn({
  cur,
  set,
  value,
  label,
}: {
  cur: FilterMode;
  set: (m: FilterMode) => void;
  value: FilterMode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => set(value)}
      className={cn(
        "flex-1 rounded-[8px] px-2 py-1.5 text-xs font-semibold",
        cur === value
          ? "bg-primary-600 text-white"
          : "bg-surface-2 text-muted hover:bg-surface-3"
      )}
    >
      {label}
    </button>
  );
}

function StatusBtn({
  cur,
  set,
  value,
  label,
}: {
  cur: FilterStatus;
  set: (s: FilterStatus) => void;
  value: FilterStatus;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => set(value)}
      className={cn(
        "flex-1 rounded-[8px] px-2 py-1.5 text-xs font-semibold",
        cur === value
          ? "bg-primary-600 text-white"
          : "bg-surface-2 text-muted hover:bg-surface-3"
      )}
    >
      {label}
    </button>
  );
}

function RowItem({ row, merchantName }: { row: Row; merchantName: string }) {
  const isDelivered = row.status === "completed";
  const isCancelled = row.status === "cancelled";
  const date = row.delivery_delivered_at ?? row.created_at;
  return (
    <li className="border-border bg-surface space-y-2 rounded-[12px] border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {row.customer_name ?? "Client"}
          </p>
          <p className="text-muted text-xs">{merchantName}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isDelivered
              ? "bg-success-100 text-success-700"
              : isCancelled
                ? "bg-danger-100 text-danger-700"
                : "bg-warning-100 text-warning-700"
          )}
        >
          {isDelivered ? (
            <Check className="size-3" />
          ) : isCancelled ? (
            <XCircle className="size-3" />
          ) : null}
          {isDelivered ? "Livrée" : isCancelled ? "Annulée" : "En cours"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {row.delivery_mode === "express" ? (
          <Chip
            icon={<Bolt className="size-3" />}
            label="Express"
            tone="orange"
          />
        ) : row.delivery_mode === "tour" ? (
          <Chip
            icon={<Calendar className="size-3" />}
            label="Tournée"
            tone="teal"
          />
        ) : null}
        {row.payment_method === "online" ? (
          <Chip
            icon={<CreditCard className="size-3" />}
            label="En ligne"
            tone="blue"
          />
        ) : (
          <Chip
            icon={<Banknote className="size-3" />}
            label="Cash"
            tone="stone"
          />
        )}
        {row.validated_without_code && <Chip label="Sans code" tone="amber" />}
      </div>

      {row.delivery_address_text && (
        <p className="text-muted flex items-start gap-1 text-xs">
          <MapPin className="mt-0.5 size-3 shrink-0" />
          {row.delivery_address_text}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-subtle tabular-nums">
          {new Date(date).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="tabular-nums">
          {row.total_da != null ? formatDA(row.total_da) : "—"}
          {row.delivery_fee_da != null && (
            <span className="text-muted ml-1">
              · livr. {formatDA(row.delivery_fee_da)}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  tone: "orange" | "teal" | "blue" | "stone" | "amber";
}) {
  const colors: Record<typeof tone, string> = {
    orange: "bg-warning-100 text-warning-700",
    teal: "bg-success-100 text-success-700",
    blue: "bg-primary-100 text-primary-700",
    stone: "bg-surface-3 text-muted",
    amber: "bg-warning-50 text-warning-800",
  };
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
        colors[tone]
      }
    >
      {icon}
      {label}
    </span>
  );
}
