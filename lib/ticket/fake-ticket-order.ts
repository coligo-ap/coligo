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
    order_number: "A042",
    pickup_code: "4281",
    pickup_slot_at: slot.toISOString(),
    created_at: now.toISOString(),
    notes: "Sans oignons s'il vous plaît, merci !",
    total_da: 1750,
    service_fee_da: 0,
    cashback_da: 0,
    payment_method: paid ? "online" : "cash",
    payment_status: paid ? "paid" : "pending",
    fulfillment_type: "pickup",
    // Aperçu : client fidèle (3e commande) → montre les paniers + le rang.
    customer_order_count: 3,
    promotions: [
      {
        type: "quantity_offer",
        title_fr: "2 achetés 1 offert",
        title_ar: "اشترِ 2 واحصل على 1",
        discount_da: 50,
        free_qty: 1,
      },
      {
        type: "promo_code",
        title_fr: "BIENVENUE10",
        title_ar: null,
        discount_da: 150,
        free_qty: 0,
      },
    ],
    items: [
      {
        product_name: "Baguette tradition",
        product_name_ar: "خبز تقليدي",
        quantity: 2,
        unit_price_da: 50,
        line_total_da: 100,
        unit: "piece",
        category_name: "Boulangerie",
      },
      {
        product_name: "Pommes de terre",
        product_name_ar: "بطاطا",
        quantity: 0.75,
        unit_price_da: 80,
        line_total_da: 60,
        unit: "kg",
        category_name: "Fruits & légumes",
      },
      {
        product_name: "Sandwich poulet maison",
        product_name_ar: "ساندويتش دجاج",
        quantity: 1,
        unit_price_da: 1250,
        line_total_da: 1250,
        unit: "piece",
        category_name: "Sandwichs",
        options: [
          {
            group_name_fr: "Taille",
            group_name_ar: "الحجم",
            option_name_fr: "Grand",
            option_name_ar: "كبير",
            price_delta_da: 200,
          },
          {
            group_name_fr: "Supplément",
            group_name_ar: "إضافة",
            option_name_fr: "Fromage",
            option_name_ar: "جبن",
            price_delta_da: 50,
          },
        ],
      },
      {
        product_name: "Croissant beurre",
        product_name_ar: "كرواسون بالزبدة",
        quantity: 1,
        unit_price_da: 0,
        line_total_da: 0,
        unit: "piece",
        is_free: true,
        category_name: "Viennoiseries",
      },
    ],
  };
}
