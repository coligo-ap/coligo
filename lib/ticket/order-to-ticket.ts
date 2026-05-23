import type { OrderWithItems } from "@/lib/types";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";

/**
 * Convertit une commande Supabase (OrderWithItems + nom du commerce) en
 * structure consommée par le builder de ticket.
 */
export function orderToTicket(
  order: OrderWithItems,
  merchantName: string
): TicketOrder {
  return {
    id: order.id,
    merchant_name: merchantName,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    pickup_code: order.pickup_code,
    pickup_slot_at: order.pickup_slot_at,
    created_at: order.created_at,
    notes: order.notes,
    total_da: order.total_da,
    service_fee_da: order.service_fee_da,
    cashback_da: order.cashback_da,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    items: order.order_items.map((it) => ({
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price_da: it.unit_price_da,
      line_total_da: it.line_total_da,
    })),
  };
}
