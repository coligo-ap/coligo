import { Badge } from "@/components/ui/badge";
import {
  ORDER_STATUS_META,
  type OrderWithItems,
} from "@/lib/types";
import { countItems, formatDA, formatRelativeTime, formatTime } from "@/lib/utils";
import { Clock, User, Hash } from "lucide-react";

interface OrderCardProps {
  order: OrderWithItems;
  /** Mode d'affichage : compact (kanban) ou detail (mobile/liste) */
  variant?: "compact" | "detail";
}

export function OrderCard({ order, variant = "compact" }: OrderCardProps) {
  const meta = ORDER_STATUS_META[order.status];
  const itemsCount = countItems(order.order_items);
  const shortId = order.id.slice(0, 6).toUpperCase();
  const pickup = formatTime(order.pickup_slot_at);

  if (variant === "compact") {
    return (
      <article className="bg-white border border-border rounded-[10px] p-3 hover:border-border-strong hover:shadow-sm transition-all cursor-pointer">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="font-mono text-xs font-semibold text-foreground">
            #{shortId}
          </span>
          <span className="text-[10px] text-subtle">
            {formatRelativeTime(order.created_at)}
          </span>
        </div>

        {/* Client */}
        <div className="text-sm font-medium truncate mb-0.5">
          {order.customer_name}
        </div>

        {/* Pickup time */}
        <div className="flex items-center gap-1 text-xs text-muted mb-2">
          <Clock className="size-3" />
          <span>{pickup}</span>
        </div>

        {/* Total */}
        <div className="flex items-center justify-between pt-2 border-t border-surface-3">
          <span className="text-xs text-muted">
            {itemsCount} {itemsCount > 1 ? "art." : "art."}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {formatDA(order.total_da)}
          </span>
        </div>
      </article>
    );
  }

  // variant === "detail" (mobile)
  return (
    <article className="bg-white border border-border rounded-[14px] p-4 hover:border-border-strong transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Hash className="size-3 text-subtle" />
            <span className="font-mono text-sm font-semibold">{shortId}</span>
          </div>
          <div className="text-xs text-muted">
            {formatRelativeTime(order.created_at)}
          </div>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <User className="size-3.5 text-subtle shrink-0" />
          <span className="font-medium truncate">{order.customer_name}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Clock className="size-3.5 text-subtle shrink-0" />
          Retrait à {pickup}
        </div>
      </div>

      {order.order_items.length > 0 && (
        <div className="text-xs text-muted mb-3 line-clamp-2">
          {order.order_items
            .map((item) => `${item.quantity}× ${item.product_name}`)
            .join(" · ")}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-surface-3">
        <span className="text-xs text-muted">
          {itemsCount} {itemsCount > 1 ? "articles" : "article"}
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatDA(order.total_da)}
        </span>
      </div>
    </article>
  );
}
