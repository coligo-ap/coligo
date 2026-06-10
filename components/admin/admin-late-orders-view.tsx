"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Bike,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  Package,
  Phone,
  RefreshCw,
  Store,
  User,
} from "lucide-react";
import Link from "next/link";
import { cn, formatDA } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { adminCancelOrder, adminValidateDelivery } from "@/app/admin/actions";
import type { AdminLateOrder } from "@/lib/data/platform";

type Props = {
  orders: AdminLateOrder[];
  thresholdMin: number;
};

/** Date + heure (fuseau Algérie figé → rendu déterministe). */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

/** Durée lisible : « 45 min » sous 1 h, « 1h05 » au-delà. */
function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h}h${String(m).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "À confirmer",
  accepted: "Acceptée",
  preparing: "En préparation",
  ready: "Prête",
};

export function AdminLateOrdersView({ orders, thresholdMin }: Props) {
  const router = useRouter();
  // Horloge client : recalcule le retard en direct, et rafraîchit la liste
  // serveur toutes les 60 s (nouvelles commandes en retard / résolues).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => router.refresh(), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  const lateMin = (iso: string): number | null =>
    now === null
      ? null
      : Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground flex items-center gap-2 text-xl font-bold">
            <AlertTriangle className="text-danger-600 size-5" />
            Commandes en retard
          </h1>
          <p className="text-muted mt-1 text-sm">
            Commandes actives dont l&apos;heure prévue est dépassée de plus de{" "}
            <strong>{thresholdMin} min</strong>. Liste rafraîchie
            automatiquement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="text-muted hover:bg-surface-2 hover:text-foreground border-border inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-sm font-medium"
        >
          <RefreshCw className="size-3.5" />
          Rafraîchir
        </button>
      </header>

      {orders.length === 0 ? (
        <div className="border-border bg-surface rounded-[16px] border p-10 text-center">
          <Clock className="text-success-500 mx-auto size-10" />
          <p className="text-foreground mt-3 text-sm font-semibold">
            Aucune commande en retard 🎉
          </p>
          <p className="text-muted mt-1 text-xs">
            Tout est sous contrôle côté commerçants.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-danger-700 bg-danger-50 border-danger-200 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold">
            <AlertTriangle className="size-4" />
            {orders.length} commande{orders.length > 1 ? "s" : ""} en retard
          </p>
          {orders.map((o) => (
            <LateOrderCard key={o.id} o={o} late={lateMin(o.pickup_slot_at)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LateOrderCard({
  o,
  late,
}: {
  o: AdminLateOrder;
  late: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ref = o.order_number ?? o.id.slice(0, 6).toUpperCase();
  const isDelivery = o.fulfillment_type === "delivery";

  const run = (
    fn: () => Promise<{ ok?: boolean; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(okMsg);
        router.refresh();
      }
    });

  function onCancel() {
    const reason = window.prompt(
      `Annuler la commande #${ref} ?\n\nMotif (visible dans le suivi) :`,
      ""
    );
    if (reason === null) return;
    run(
      () => adminCancelOrder(o.id, reason.trim() || "Annulée par le support"),
      "Commande annulée"
    );
  }

  return (
    <div className="border-danger-200 bg-surface rounded-[16px] border-l-4 p-4 shadow-sm">
      {/* En-tête : réf + retard + total */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-foreground font-mono text-lg font-extrabold">
          #{ref}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tabular-nums",
            "bg-danger-100 text-danger-700"
          )}
        >
          <AlertTriangle className="size-3.5" />
          {late === null ? "Retard…" : `En retard de ${fmtDur(late)}`}
        </span>
        <span className="text-foreground ml-auto text-base font-bold tabular-nums">
          {o.total_da != null ? formatDA(o.total_da) : "—"}
        </span>
      </div>

      {/* Grille d'infos */}
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Info icon={Store} label="Commerçant">
          <span className="font-medium">{o.merchant_name}</span>
          {o.merchant_city && (
            <span className="text-muted"> · {o.merchant_city}</span>
          )}
          {o.merchant_manager && (
            <span className="text-muted block text-xs">
              Gérant : {o.merchant_manager}
            </span>
          )}
          {o.merchant_phone && (
            <a
              href={`tel:${o.merchant_phone}`}
              className="text-primary-700 mt-0.5 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Phone className="size-3" />
              {o.merchant_phone}
            </a>
          )}
        </Info>

        <Info icon={User} label="Client">
          <span className="font-medium">{o.customer_name ?? "Client"}</span>
          {o.customer_phone && (
            <a
              href={`tel:${o.customer_phone}`}
              className="text-primary-700 mt-0.5 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Phone className="size-3" />
              {o.customer_phone}
            </a>
          )}
        </Info>

        <Info icon={Clock} label="Heure de passage">
          {fmtDateTime(o.created_at)}
        </Info>

        <Info icon={Clock} label="Heure prévue">
          <span className="text-danger-700 font-semibold">
            {fmtDateTime(o.pickup_slot_at)}
          </span>
        </Info>

        <Info icon={isDelivery ? Bike : Package} label="Type de retrait">
          {isDelivery ? "Livraison" : "Retrait sur place"}
          {isDelivery && o.delivery_mode && (
            <span className="text-muted">
              {" "}
              · {o.delivery_mode === "express" ? "Express" : "Tournée"}
            </span>
          )}
        </Info>

        <Info icon={CreditCard} label="Paiement">
          {o.payment_method === "online" ? "En ligne" : "Espèces"}
          <span className="text-muted">
            {" "}
            · {o.payment_status === "paid" ? "payé" : (o.payment_status ?? "—")}
          </span>
        </Info>
      </dl>

      {/* Pied : statut courant */}
      <div className="border-border mt-3 flex items-center gap-2 border-t pt-2.5">
        <span className="text-muted text-xs">Statut :</span>
        <span className="bg-surface-2 text-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
          {STATUS_LABEL[o.status] ?? o.status}
        </span>
        {o.pickup_code && (
          <span className="text-muted ml-auto font-mono text-xs">
            PIN {o.pickup_code}
          </span>
        )}
      </div>

      {/* Actions — contrôle du flux directement depuis l'alerte. */}
      <div className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3">
        {isDelivery && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => adminValidateDelivery(o.id), "Livraison validée")
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
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          <Ban className="size-3.5" />
          Annuler
        </button>
        <Link
          href="/admin/orders"
          className="border-border hover:bg-surface-2 text-foreground ml-auto inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-xs font-bold"
        >
          <ExternalLink className="size-3.5" />
          Gérer
        </Link>
      </div>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="text-muted mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <dt className="text-muted text-[11px] font-semibold tracking-wide uppercase">
          {label}
        </dt>
        <dd className="text-foreground">{children}</dd>
      </div>
    </div>
  );
}
