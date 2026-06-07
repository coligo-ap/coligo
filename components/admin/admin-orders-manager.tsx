"use client";

import { useMemo, useState, useTransition } from "react";
import { Ban, Check, Loader2, Wallet } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import {
  adminCancelOrder,
  adminRefundMerchant,
  adminValidateDelivery,
} from "@/app/admin/actions";

type Row = {
  id: string;
  order_number: string | null;
  status: string;
  fulfillment_type: string | null;
  delivery_mode: string | null;
  payment_method: string;
  payment_status: string;
  total_da: number;
  delivery_fee_da: number | null;
  delivery_driver_id: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
  delivery_delivered_at: string | null;
  customer_name: string | null;
  merchant_id: string;
  merchant_name: string;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "À confirmer",
  accepted: "Acceptée",
  preparing: "En préparation",
  ready: "Prête",
  completed: "Terminée",
  cancelled: "Annulée",
};

const FILTERS = [
  { key: "active", label: "En cours" },
  { key: "all", label: "Toutes" },
  { key: "completed", label: "Terminées" },
  { key: "cancelled", label: "Annulées" },
] as const;

const ACTIVE = ["pending", "accepted", "preparing", "ready"];

export function AdminOrdersManager({ rows }: { rows: Row[] }) {
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number]["key"]>("active");

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "active")
      return rows.filter((r) => ACTIVE.includes(r.status));
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (filter === f.key
                ? "bg-primary-600 text-white"
                : "border-border text-muted hover:bg-surface-2 border")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">Aucune commande.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <OrderRow key={r.id} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderRow({ row }: { row: Row }) {
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<null | "cancel" | "refund">(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");

  const isDelivery = row.fulfillment_type === "delivery";
  const terminal = row.status === "completed" || row.status === "cancelled";

  const run = (
    fn: () => Promise<{ ok?: boolean; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(okMsg);
        setModal(null);
        setReason("");
        setAmount("");
      }
    });

  return (
    <li className="border-border bg-surface rounded-[14px] border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold">
            #{row.order_number ?? row.id.slice(0, 6).toUpperCase()}
          </p>
          <p className="text-muted mt-0.5 truncate text-xs">
            {row.merchant_name} · {row.customer_name ?? "Client"} ·{" "}
            {isDelivery ? "Livraison" : "Retrait"} ·{" "}
            {row.payment_method === "online" ? "En ligne" : "Espèces"}
          </p>
          <p className="text-subtle mt-1 text-[11px]">
            {new Date(row.created_at).toLocaleString("fr-DZ", {
              timeZone: "Africa/Algiers",
            })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="bg-surface-3 text-foreground rounded-full px-2.5 py-1 text-[11px] font-bold">
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
          <p className="mt-1 text-sm font-bold tabular-nums">
            {formatDA(row.total_da)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {isDelivery && !terminal && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => adminValidateDelivery(row.id), "Livraison validée")
            }
            className="bg-success-600 hover:bg-success-700 inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Valider la livraison
          </button>
        )}
        {!terminal && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setModal("cancel")}
            className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            <Ban className="size-3.5" />
            Annuler
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setModal("refund")}
          className="border-border hover:bg-surface-2 inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          <Wallet className="size-3.5" />
          Rembourser le commerçant
        </button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-[18px] bg-white p-5 shadow-2xl">
            <h3 className="text-foreground text-base font-black">
              {modal === "cancel"
                ? "Annuler la commande"
                : "Rembourser le commerçant"}
            </h3>
            <p className="text-muted mt-1 text-xs">
              #{row.order_number ?? row.id.slice(0, 6).toUpperCase()} ·{" "}
              {row.merchant_name}
            </p>

            {modal === "refund" && (
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                placeholder="Montant (DA)"
                className="border-border bg-surface-2 mt-3 w-full rounded-[12px] border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
              />
            )}

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              rows={2}
              placeholder={
                modal === "cancel"
                  ? "Motif de l'annulation"
                  : "Motif du remboursement (ex. commande prête, client injoignable)"
              }
              className="border-border bg-surface-2 text-foreground mt-3 w-full resize-none rounded-[12px] border px-3 py-2.5 text-[13px] outline-none"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="border-border text-muted flex-1 rounded-[12px] border py-2.5 text-sm font-bold"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={
                  pending ||
                  (modal === "refund" && (amount === "" || Number(amount) < 1))
                }
                onClick={() =>
                  modal === "cancel"
                    ? run(
                        () => adminCancelOrder(row.id, reason.trim()),
                        "Commande annulée"
                      )
                    : run(
                        () =>
                          adminRefundMerchant(
                            row.id,
                            Number(amount),
                            reason.trim()
                          ),
                        "Commerçant remboursé"
                      )
                }
                className={
                  "inline-flex flex-1 items-center justify-center gap-1 rounded-[12px] py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                  (modal === "cancel"
                    ? "bg-danger-600 hover:bg-danger-700"
                    : "bg-primary-600 hover:bg-primary-700")
                }
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : modal === "cancel" ? (
                  "Confirmer l'annulation"
                ) : (
                  "Créditer"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
