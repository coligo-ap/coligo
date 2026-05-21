import {
  KANBAN_COLUMNS,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/types";
import { OrderCard } from "./order-card";
import { Inbox } from "lucide-react";

interface KanbanBoardProps {
  orders: OrderWithItems[];
}

const COLUMN_TONES = {
  0: {
    bg: "bg-primary-50/50",
    border: "border-primary-200",
    header: "text-primary-900",
    count: "bg-primary-100 text-primary-800",
  },
  1: {
    bg: "bg-primary-50/50",
    border: "border-primary-200",
    header: "text-primary-900",
    count: "bg-primary-100 text-primary-800",
  },
  2: {
    bg: "bg-green-50/50",
    border: "border-green-200",
    header: "text-green-900",
    count: "bg-green-100 text-green-800",
  },
  3: {
    bg: "bg-surface-3/60",
    border: "border-border",
    header: "text-foreground",
    count: "bg-border text-foreground",
  },
} as const;

export function KanbanBoard({ orders }: KanbanBoardProps) {
  // Grouper les commandes par colonne
  const ordersByColumn = new Map<number, OrderWithItems[]>();
  for (const col of KANBAN_COLUMNS) {
    ordersByColumn.set(col.id, []);
  }
  for (const order of orders) {
    const col = KANBAN_COLUMNS.find((c) =>
      c.statuses.includes(order.status as OrderStatus)
    );
    if (col) {
      ordersByColumn.get(col.id)!.push(order);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3 lg:gap-4">
      {KANBAN_COLUMNS.map((col) => {
        const colOrders = ordersByColumn.get(col.id) ?? [];
        const tone = COLUMN_TONES[col.id as 0 | 1 | 2 | 3];

        return (
          <section
            key={col.id}
            className={`flex flex-col rounded-[14px] border ${tone.border} ${tone.bg} min-h-[400px]`}
          >
            {/* Header colonne */}
            <header className="border-border/60 flex items-center justify-between gap-2 border-b px-4 py-3">
              <h3 className={`text-sm font-semibold ${tone.header}`}>
                {col.title}
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone.count}`}
              >
                {colOrders.length}
              </span>
            </header>

            {/* Cartes */}
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {colOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Inbox className="text-border-strong mb-2 size-6" />
                  <span className="text-subtle text-xs">Aucune commande</span>
                </div>
              ) : (
                colOrders.map((order) => (
                  <OrderCard key={order.id} order={order} variant="compact" />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
