import Link from "next/link";
import { CalendarClock, Clock } from "lucide-react";
import type { OrderWithItems } from "@/lib/types";
import { scheduledFireAt } from "@/lib/orders/scheduled";
import { ScheduledRefresher } from "@/components/merchant/scheduled-refresher";

/**
 * Section « Commandes programmées » du dashboard : les commandes à créneau
 * FUTUR, retirées de la file active tant que leur « fire time » n'est pas
 * atteinte. Visuellement DISTINCTE (ambre) avec date + heure bien visibles,
 * pour anticiper stock & personnel sans risquer de les préparer trop tôt.
 *
 * Elles basculent automatiquement dans le board à l'heure (bascule dérivée côté
 * dashboard) — ici on n'affiche QUE celles encore à venir.
 */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-DZ", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

export function ScheduledOrders({
  orders,
  prepTimeMin,
}: {
  orders: OrderWithItems[];
  prepTimeMin: number;
}) {
  if (orders.length === 0) return null;

  // Prochaine bascule (plus petite fire time) → rafraîchit le board pile à l'heure.
  const nextFire = orders
    .map((o) =>
      scheduledFireAt(
        o as unknown as { pickup_type?: string; pickup_slot_at?: string },
        prepTimeMin
      )
    )
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <section className="mb-5">
      {nextFire && (
        <ScheduledRefresher nextFireAtIso={nextFire.toISOString()} />
      )}
      <div className="mb-2.5 flex items-center gap-2">
        <CalendarClock className="size-5 text-amber-600" />
        <h2 className="text-foreground text-base font-bold">
          Commandes programmées
        </h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
          {orders.length}
        </span>
        <span className="text-muted text-xs font-medium">
          — à préparer plus tard, pas maintenant
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {orders.map((o) => {
          const ref = o.order_number ?? o.id.slice(0, 6).toUpperCase();
          const fire = scheduledFireAt(
            o as unknown as { pickup_type?: string; pickup_slot_at?: string },
            prepTimeMin
          );
          const isDelivery =
            (o as { fulfillment_type?: string }).fulfillment_type ===
            "delivery";
          const count = o.order_items.reduce((s, it) => {
            const q = Number(it.quantity) || 0;
            return s + (Number.isInteger(q) ? q : 1);
          }, 0);
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="rounded-card-lg block border border-amber-300 bg-amber-50 p-3 transition-colors hover:bg-amber-100/70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-extrabold text-amber-900">
                  #{ref}
                </span>
                <span className="text-micro rounded-full bg-amber-600 px-2 py-0.5 font-extrabold text-white">
                  📅 PROGRAMMÉE
                </span>
              </div>
              <p className="text-title-sm mt-1.5 font-bold text-amber-900">
                {isDelivery ? "Livraison" : "Retrait"} ·{" "}
                {fmtDateTime(o.pickup_slot_at)}
              </p>
              {fire && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                  <Clock className="size-3.5" />À préparer dès{" "}
                  {fmtTime(fire.toISOString())}
                </p>
              )}
              <p className="text-muted mt-1 truncate text-xs">
                {o.customer_name} · {count} article{count > 1 ? "s" : ""}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
