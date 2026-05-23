import type { TicketOrder } from "@/lib/ticket/build-ticket-html";

/**
 * Construit une commande factice pour l'aperçu / le ticket de test.
 * Pas de persistance : c'est juste un objet TicketOrder qui ressemble à un
 * vrai cas (3 articles, code 6 chiffres, créneau ~1h).
 */
export function buildFakeTicketOrder({
  merchantName,
  paid,
}: {
  merchantName: string;
  /** true → carte payée en ligne ; false → cash à encaisser. */
  paid: boolean;
}): TicketOrder {
  const now = new Date();
  const slot = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    id: "TEST" + now.getTime().toString(36).slice(-4).toUpperCase(),
    merchant_name: merchantName,
    customer_name: "Yacine Boudjellal",
    customer_phone: "+213 555 12 34 56",
    pickup_code: "428173",
    pickup_slot_at: slot.toISOString(),
    created_at: now.toISOString(),
    notes: "Sans oignons s'il vous plaît, merci !",
    total_da: 1750,
    service_fee_da: 0,
    cashback_da: 0,
    payment_method: paid ? "online" : "cash",
    payment_status: paid ? "paid" : "pending",
    items: [
      {
        product_name: "Baguette tradition",
        quantity: 2,
        unit_price_da: 50,
        line_total_da: 100,
        category_name: "Boulangerie",
      },
      {
        product_name: "Croissant beurre",
        quantity: 4,
        unit_price_da: 100,
        line_total_da: 400,
        category_name: "Viennoiseries",
      },
      {
        product_name: "Sandwich poulet maison",
        quantity: 1,
        unit_price_da: 1250,
        line_total_da: 1250,
        category_name: "Sandwichs",
      },
    ],
  };
}
