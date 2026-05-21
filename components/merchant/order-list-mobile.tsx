"use client";

import { useState } from "react";
import {
  KANBAN_COLUMNS,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/types";
import { OrderCard } from "./order-card";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileOrderListProps {
  orders: OrderWithItems[];
}

export function MobileOrderList({ orders }: MobileOrderListProps) {
  const [activeTab, setActiveTab] = useState<number>(0);

  // Grouper par colonne
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

  const visible = ordersByColumn.get(activeTab) ?? [];

  return (
    <div>
      {/* Tabs */}
      <div className="scrollbar-hide -mx-4 mb-4 flex gap-1 overflow-x-auto px-4">
        {KANBAN_COLUMNS.map((col) => {
          const count = ordersByColumn.get(col.id)?.length ?? 0;
          const active = activeTab === col.id;

          return (
            <button
              key={col.id}
              onClick={() => setActiveTab(col.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-primary-100 text-primary-900"
                  : "bg-surface-3 text-muted hover:bg-border"
              )}
            >
              {col.title}
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-primary-900" : "text-muted"
                )}
              >
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Liste */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-surface-3 mb-3 flex size-12 items-center justify-center rounded-full">
            <Inbox className="text-subtle size-5" />
          </div>
          <p className="text-muted text-sm">Aucune commande</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((order) => (
            <OrderCard key={order.id} order={order} variant="detail" />
          ))}
        </div>
      )}
    </div>
  );
}
