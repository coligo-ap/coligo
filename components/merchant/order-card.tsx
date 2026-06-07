import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_META, type OrderWithItems } from "@/lib/types";
import { deliveryPhase } from "@/lib/delivery/merchant-status";
import {
  countItems,
  formatDA,
  formatRelativeTime,
  formatTime,
} from "@/lib/utils";
import {
  Banknote,
  Bolt,
  Calendar,
  Clock,
  CreditCard,
  Hash,
  MapPin,
  Truck,
  User,
} from "lucide-react";

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
  const isDelivery = order.fulfillment_type === "delivery";

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

        {/* Badges fulfillment / mode / payment */}
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <OrderBadges order={order} compact />
        </div>

        {/* Client */}
        <div className="mb-0.5 truncate text-sm font-medium">
          {order.customer_name}
        </div>

        {/* Pickup / Delivery time */}
        <div className="text-muted mb-2 flex items-center gap-1 text-xs">
          <Clock className="size-3" />
          <span>{isDelivery ? `Livraison · ${pickup}` : pickup}</span>
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
        {(() => {
          // Livraison : on montre la PHASE réelle (livrée / en livraison /
          // livreur en route…) plutôt que « Récupérée » ou « Prête » figés.
          const phase = deliveryPhase(order);
          if (phase) {
            const tone =
              phase.tone === "success"
                ? "green"
                : phase.tone === "amber"
                  ? "amber"
                  : phase.tone === "neutral"
                    ? "stone"
                    : "teal";
            return <Badge tone={tone}>{phase.short}</Badge>;
          }
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        })()}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <OrderBadges order={order} />
      </div>

      <div className="mb-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <User className="text-subtle size-3.5 shrink-0" />
          <span className="truncate font-medium">{order.customer_name}</span>
        </div>
        <div className="text-muted flex items-center gap-2 text-sm">
          <Clock className="text-subtle size-3.5 shrink-0" />
          {isDelivery ? `Livraison · ${pickup}` : `Retrait à ${pickup}`}
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

/**
 * Badges visuels : Retrait vs Livraison (Express/Tournée), Cash vs En ligne.
 * Aide le commerçant à voir au premier coup d'œil le type de commande.
 */
function OrderBadges({
  order,
  compact = false,
}: {
  order: OrderWithItems;
  compact?: boolean;
}) {
  const isDelivery = order.fulfillment_type === "delivery";
  const isOnline = order.payment_method === "online";
  const paid = order.payment_status === "paid";

  return (
    <>
      {isDelivery ? (
        <BadgeChip
          icon={
            order.delivery_mode === "express" ? (
              <Bolt className="size-3" />
            ) : (
              <Calendar className="size-3" />
            )
          }
          label={order.delivery_mode === "express" ? "Express" : "Tournée"}
          tone="orange"
          compact={compact}
        />
      ) : (
        <BadgeChip
          icon={<MapPin className="size-3" />}
          label="Retrait"
          tone="teal"
          compact={compact}
        />
      )}
      {isOnline ? (
        <BadgeChip
          icon={<CreditCard className="size-3" />}
          label={paid ? "Payé" : "En ligne"}
          tone={paid ? "green" : "amber"}
          compact={compact}
        />
      ) : (
        <BadgeChip
          icon={<Banknote className="size-3" />}
          label="Cash"
          tone="stone"
          compact={compact}
        />
      )}
      {isDelivery &&
        (() => {
          const phase = deliveryPhase(order);
          const tone =
            phase?.tone === "success"
              ? "green"
              : phase?.tone === "amber"
                ? "orange"
                : phase?.tone === "neutral"
                  ? "stone"
                  : "violet";
          return (
            <BadgeChip
              icon={<Truck className="size-3" />}
              label={phase?.short ?? "À livrer"}
              tone={tone}
              compact={compact}
            />
          );
        })()}
    </>
  );
}

function BadgeChip({
  icon,
  label,
  tone,
  compact,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "teal" | "orange" | "green" | "amber" | "stone" | "violet";
  compact?: boolean;
}) {
  const colors: Record<typeof tone, string> = {
    teal: "bg-primary-100 text-primary-700",
    orange: "bg-warning-100 text-warning-700",
    green: "bg-success-100 text-success-700",
    amber: "bg-warning-50 text-warning-800",
    stone: "bg-surface-3 text-muted",
    violet: "bg-violet-100 text-violet-700",
  };
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full font-semibold " +
        colors[tone] +
        (compact ? " px-1.5 py-0.5 text-[10px]" : " px-2 py-0.5 text-xs")
      }
    >
      {icon}
      {label}
    </span>
  );
}
