import type { OrderWithItems } from "@/lib/types";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import { WILAYAS } from "@/lib/config/wilayas";

export type OrderToTicketExtras = {
  merchantCity?: string | null;
  merchantWilayaCode?: string | null;
  isNewCustomer?: boolean;
};

/**
 * Convertit une commande Supabase (OrderWithItems + nom du commerce) en
 * structure consommée par le builder de ticket. La map des catégories est
 * facultative — sans elle, tous les items tombent sous un seul groupe
 * « ARTICLES » côté ticket.
 *
 * `extras` permet de propager la localité du commerce (« Wilaya · Ville »)
 * et un flag « nouveau client » que le ticket affichera en badge.
 */
export function orderToTicket(
  order: OrderWithItems,
  merchantName: string,
  categoryMap: Record<string, string> = {},
  extras: OrderToTicketExtras = {}
): TicketOrder {
  return {
    id: order.id,
    merchant_name: merchantName,
    merchant_locality: buildLocality(extras),
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    order_number: order.order_number ?? null,
    pickup_code: order.pickup_code,
    pickup_slot_at: order.pickup_slot_at,
    created_at: order.created_at,
    notes: order.notes,
    total_da: order.total_da,
    service_fee_da: order.service_fee_da,
    cashback_da: order.cashback_da,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    is_new_customer: extras.isNewCustomer ?? false,
    items: order.order_items.map((it) => ({
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price_da: it.unit_price_da,
      line_total_da: it.line_total_da,
      category_name: categoryMap[it.product_name],
    })),
  };
}

/** Construit "Wilaya · Ville" à partir du code wilaya + city ; null si rien. */
function buildLocality(extras: OrderToTicketExtras): string | null {
  const w = WILAYAS.find((x) => x.code === extras.merchantWilayaCode)?.name;
  const c = extras.merchantCity?.trim() || null;
  if (w && c) return `${w} · ${c}`;
  return w ?? c ?? null;
}
