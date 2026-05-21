import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_META, type OrderWithItems } from "@/lib/types";
import {
  countItems,
  formatDA,
  formatRelativeTime,
  formatTime,
} from "@/lib/utils";
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
      <Link
        href={`/orders/${order.id}`}
        className="border-border hover:border-border-strong block cursor-pointer rounded-[10px] border bg-white p-3 transition-all hover:shadow-sm"
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-foreground font-mono text-xs font-semibold">
            #{shortId}
          </span>
          <span className="text-subtle text-[10px]">
            {formatRelativeTime(order.created_at)}
          </span>
        </div>

        {/* Client */}
        <div className="mb-0.5 truncate text-sm font-medium">
          {order.customer_name}
        </div>

        {/* Pickup time */}
        <div className="text-muted mb-2 flex items-center gap-1 text-xs">
          <Clock className="size-3" />
          <span>{pickup}</span>
        </div>

        {/* Total */}
        <div className="border-surface-3 flex items-center justify-between border-t pt-2">
          <span className="text-muted text-xs">
            {itemsCount} {itemsCount > 1 ? "art." : "art."}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {formatDA(order.total_da)}
          </span>
        </div>
      </Link>
    );
  }

  // variant === "detail" (mobile)
  return (
    <Link
      href={`/orders/${order.id}`}
      className="border-border hover:border-border-strong block rounded-[14px] border bg-white p-4 transition-all"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1.5">
            <Hash className="text-subtle size-3" />
            <span className="font-mono text-sm font-semibold">{shortId}</span>
          </div>
          <div className="text-muted text-xs">
            {formatRelativeTime(order.created_at)}
          </div>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <div className="mb-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <User className="text-subtle size-3.5 shrink-0" />
          <span className="truncate font-medium">{order.customer_name}</span>
        </div>
        <div className="text-muted flex items-center gap-2 text-sm">
          <Clock className="text-subtle size-3.5 shrink-0" />
          Retrait à {pickup}
        </div>
      </div>

      {order.order_items.length > 0 && (
        <div className="text-muted mb-3 line-clamp-2 text-xs">
          {order.order_items
            .map((item) => `${item.quantity}× ${item.product_name}`)
            .join(" · ")}
        </div>
      )}

      <div className="border-surface-3 flex items-center justify-between border-t pt-3">
        <span className="text-muted text-xs">
          {itemsCount} {itemsCount > 1 ? "articles" : "article"}
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatDA(order.total_da)}
        </span>
      </div>
    </Link>
  );
}
