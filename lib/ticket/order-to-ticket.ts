import type { OrderWithItems } from "@/lib/types";
import type {
  TicketOrder,
  TicketItemOption,
  TicketPromotion,
} from "@/lib/ticket/build-ticket-html";
import { WILAYAS } from "@/lib/config/wilayas";

export type OrderToTicketExtras = {
  merchantCity?: string | null;
  merchantWilayaCode?: string | null;
  isNewCustomer?: boolean;
  /** Nombre total de commandes du client chez ce commerçant (fidélité). */
  customerOrderCount?: number | null;
  /** Promotions appliquées (snapshot order_promotions) — résumé bilingue. */
  promotions?: TicketPromotion[];
  /** Date/heure cible ISO si commande PROGRAMMÉE (→ bandeau ticket). */
  scheduledFor?: string | null;
};

/** Ligne de commande enrichie (colonnes 0262 + jointure order_item_options). */
type RichOrderItem = OrderWithItems["order_items"][number] & {
  unit?: string | null;
  name_ar?: string | null;
  is_free?: boolean | null;
  order_item_options?: {
    group_name_fr: string;
    group_name_ar: string | null;
    option_name_fr: string;
    option_name_ar: string | null;
    price_delta_da: number;
    position: number;
  }[];
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
    fulfillment_type: order.fulfillment_type ?? "pickup",
    delivery_address: order.delivery_address_text ?? null,
    delivery_phone: order.delivery_phone ?? null,
    delivery_note: order.delivery_note ?? null,
    is_new_customer: extras.isNewCustomer ?? false,
    customer_order_count: extras.customerOrderCount ?? null,
    promotions: extras.promotions ?? [],
    scheduled_for: extras.scheduledFor ?? null,
    items: (order.order_items as RichOrderItem[]).map((it) => {
      const options: TicketItemOption[] = (it.order_item_options ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((o) => ({
          group_name_fr: o.group_name_fr,
          group_name_ar: o.group_name_ar,
          option_name_fr: o.option_name_fr,
          option_name_ar: o.option_name_ar,
          price_delta_da: o.price_delta_da,
        }));
      return {
        product_name: it.product_name,
        product_name_ar: it.name_ar ?? null,
        quantity: it.quantity,
        unit_price_da: it.unit_price_da,
        line_total_da: it.line_total_da,
        unit: it.unit ?? null,
        is_free: it.is_free ?? false,
        options: options.length ? options : undefined,
        category_name: categoryMap[it.product_name],
      };
    }),
  };
}

/** Construit "Wilaya · Ville" à partir du code wilaya + city ; null si rien. */
function buildLocality(extras: OrderToTicketExtras): string | null {
  const w = WILAYAS.find((x) => x.code === extras.merchantWilayaCode)?.name;
  const c = extras.merchantCity?.trim() || null;
  if (w && c) return `${w} · ${c}`;
  return w ?? c ?? null;
}
