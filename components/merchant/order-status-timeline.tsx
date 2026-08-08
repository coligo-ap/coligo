import { Check } from "lucide-react";
import {
  ORDER_FLOW,
  orderFlowIndex,
  type OrderEvent,
  type OrderStatus,
} from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

/**
 * Timeline verticale des statuts d'une commande. L'étape courante est mise en
 * avant en violet, les précédentes sont validées (check) avec l'horodatage issu
 * de `order_events`, les suivantes grisées.
 */
export function OrderStatusTimeline({
  status,
  events = [],
}: {
  status: OrderStatus;
  events?: OrderEvent[];
}) {
  // Horodatage du passage à chaque statut (dernier event vers ce statut).
  const reachedAt = new Map<OrderStatus, string>();
  for (const ev of events) reachedAt.set(ev.to_status, ev.created_at);

  if (status === "cancelled") {
    const at = reachedAt.get("cancelled");
    return (
      <div className="bg-danger-50 text-danger-700 flex items-center justify-between gap-2 rounded-md px-4 py-3 text-sm font-medium">
        <span>Commande annulée</span>
        {at && (
          <span className="text-danger-600/80 text-xs">{formatTime(at)}</span>
        )}
      </div>
    );
  }

  const currentIndex = orderFlowIndex(status);

  return (
    <ol className="relative space-y-0">
      {ORDER_FLOW.map((step, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const isLast = i === ORDER_FLOW.length - 1;
        const at = reachedAt.get(step.status);

        return (
          <li key={step.status} className="flex gap-3">
            {/* Pastille + ligne */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  done && "border-primary-600 bg-primary-600 text-white",
                  current && "border-primary-600 text-primary-700 bg-white",
                  !done && !current && "border-border text-subtle bg-white"
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              {!isLast && (
                <span
                  className={cn(
                    "min-h-8 w-0.5 flex-1",
                    done ? "bg-primary-600" : "bg-border"
                  )}
                />
              )}
            </div>

            {/* Label + horodatage */}
            <div
              className={cn(
                "flex flex-1 items-start justify-between pb-6",
                isLast && "pb-0"
              )}
            >
              <p
                className={cn(
                  "text-sm leading-7",
                  current && "text-primary-700 font-semibold",
                  done && "text-foreground font-medium",
                  !done && !current && "text-subtle"
                )}
              >
                {step.label}
              </p>
              {at && (done || current) && (
                <span className="text-subtle mt-1 text-xs">
                  {formatTime(at)}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
