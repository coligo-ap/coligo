import { Check } from "lucide-react";
import { ORDER_FLOW, orderFlowIndex, type OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Timeline verticale des statuts d'une commande. L'étape courante est mise en
 * avant en violet, les précédentes sont validées (check), les suivantes grisées.
 * Pour une commande annulée, on affiche un état dédié.
 */
export function OrderStatusTimeline({ status }: { status: OrderStatus }) {
  if (status === "cancelled") {
    return (
      <div className="bg-danger-50 text-danger-700 flex items-center gap-2 rounded-[12px] px-4 py-3 text-sm font-medium">
        Commande annulée
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

            {/* Label */}
            <div className={cn("pb-6", isLast && "pb-0")}>
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
