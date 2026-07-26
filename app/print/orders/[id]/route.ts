/**
 * Endpoint d'impression isolé — la solution cross-platform pour le print.
 *
 * Au lieu de bricoler `@media print` + un mount dans le document de l'app
 * (qui pose des bugs subtils sur iOS Safari / Chrome Android — le navigateur
 * snapshote l'app avant que la bascule ne se fasse), on retourne une page
 * HTML BRUTE qui ne contient QUE le ticket et un script auto-print + back.
 *
 * Aucune route Next.js / aucun root layout / aucune coque app : c'est une
 * Response HTML pure. Le navigateur n'a littéralement RIEN d'autre à
 * imprimer que le ticket. Bug « capture d'écran » impossible.
 */

import { createClient } from "@/lib/supabase/server";
import { buildTicketHTML } from "@/lib/ticket/build-ticket-html";
import { orderToTicket } from "@/lib/ticket/order-to-ticket";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import { fetchCustomerOrderCount } from "@/lib/ticket/customer-orders";
import { isScheduled } from "@/lib/orders/scheduled";
import { APP_CONFIG } from "@/lib/config/app-config";
import type { OrderWithItems, PrintWidth } from "@/lib/types";

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const widthParam = url.searchParams.get("width");
  const widthMm = (
    widthParam === "80" ? 80 : widthParam === "58" ? 58 : 50
  ) as PrintWidth;
  const copies = Math.max(
    1,
    Math.min(3, Number(url.searchParams.get("copies") ?? "1") || 1)
  );
  // Sanitize backHref : seulement les chemins absolus internes (commence par
  // « / » mais pas « // » qui serait un protocol-relative URL externe).
  const backParam = url.searchParams.get("back");
  const backHref =
    backParam && backParam.startsWith("/") && !backParam.startsWith("//")
      ? backParam
      : `/orders/${id}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Non autorisé.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // RLS garantit qu'on ne récupère qu'une commande du commerçant connecté.
  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      `id, merchant_id, customer_name, customer_phone, status,
       total_da, service_fee_da, cashback_da, commission_da,
       pickup_code, order_number, pickup_type, pickup_slot_at, notes, created_at,
       payment_method, payment_status, fulfillment_type,
       delivery_address_text, delivery_phone, delivery_note,
       order_items ( id, order_id, product_name, name_ar, unit, is_free,
         unit_price_da, quantity, line_total_da,
         order_item_options ( group_name_fr, group_name_ar, option_name_fr,
           option_name_ar, price_delta_da, position ) )`
    )
    .eq("id", id)
    .maybeSingle();

  if (!orderRow) {
    return new Response("Commande introuvable.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const order = orderRow as unknown as OrderWithItems;

  const { data: merchant } = await supabase
    .from("merchants")
    .select("name, city, wilaya_code, print_lang")
    .eq("id", order.merchant_id)
    .maybeSingle();
  // Langue unique du ticket (jamais FR/AR mélangés) — relue en DB, source de
  // vérité des réglages d'impression du commerçant.
  const printLang =
    (merchant as { print_lang?: string | null } | null)?.print_lang === "ar"
      ? ("ar" as const)
      : ("fr" as const);

  const categoryMap = await fetchCategoryMap(
    supabase,
    order.merchant_id,
    order.order_items.map((it) => it.product_name)
  );
  const customerOrderCount = await fetchCustomerOrderCount(
    supabase,
    order.merchant_id,
    order.customer_phone
  );

  // Promotions appliquées (snapshot) — résumé bilingue sur le ticket.
  const { data: promoRows } = await supabase
    .from("order_promotions")
    .select("type, title_fr, title_ar, discount_da, free_qty, position")
    .eq("order_id", id)
    .order("position", { ascending: true });

  const ticketOrder = orderToTicket(
    order,
    merchant?.name ?? APP_CONFIG.name,
    categoryMap,
    {
      merchantCity: merchant?.city,
      merchantWilayaCode: merchant?.wilaya_code,
      customerOrderCount,
      scheduledFor: isScheduled(
        order as unknown as { pickup_type?: string; pickup_slot_at?: string }
      )
        ? order.pickup_slot_at
        : null,
      promotions: (promoRows ?? []).map((p) => ({
        type: p.type,
        title_fr: p.title_fr,
        title_ar: p.title_ar,
        discount_da: p.discount_da,
        free_qty: p.free_qty,
      })),
    }
  );

  // Multi-copies : on rend chaque ticket dans un .ticket-page avec
  // page-break-after entre eux → une seule fenêtre d'impression imprime N
  // exemplaires, et le navigateur les sépare proprement.
  const copiesHtml: string[] = [];
  for (let i = 1; i <= copies; i++) {
    const copyLabel = copies > 1 ? `COPIE ${i} / ${copies}` : undefined;
    const { html } = await buildTicketHTML(ticketOrder, {
      width: widthMm,
      appName: APP_CONFIG.name,
      copyLabel,
      lang: printLang,
    });
    copiesHtml.push(`<div class="ticket-page">${html}</div>`);
  }

  const shortId = order.id.slice(0, 6).toUpperCase();
  const title = `Ticket de commande - #${shortId}`;
  const backHrefSafe = JSON.stringify(backHref);

  // Détection Sunmi serveur-side via UA → on adapte le message
  // (« Impression directe… » au lieu de « Retour ») et on relance back()
  // plus vite : sur un V3 configuré en auto-print, `afterprint` peut être
  // instantané, voire ne pas fire du tout.
  const ua = req.headers.get("user-agent") ?? "";
  const isSunmi = /sunmi/i.test(ua);

  const fullHtml = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${widthMm}mm;
    /* 2mm de marge de chaque côté → zone imprimable réelle. */
    padding: 2mm;
    font-family: Arial, Helvetica, "Segoe UI", sans-serif;
    font-size: 13px;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  * { box-sizing: border-box; }
  .ticket-page { page-break-after: always; break-after: page; }
  .ticket-page:last-child { page-break-after: auto; break-after: auto; }
  /* Petit bouton de secours « Retour » au cas où la fenêtre print ne
     s'ouvrirait pas ou que l'utilisateur la ferme sans naviguer. Caché à
     l'impression. */
  .back-fab {
    position: fixed; top: 8px; left: 8px; z-index: 9999;
    display: inline-flex; align-items: center; gap: 4px;
    padding: 8px 12px; border-radius: 999px;
    background: #6c2bd9; color: #fff; text-decoration: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @media print { .back-fab { display: none !important; } }
</style>
</head>
<body>
<a class="back-fab" href=${backHrefSafe} aria-label="Retour à la commande">${
    isSunmi ? "Impression en cours..." : "&larr; Retour"
  }</a>
${copiesHtml.join("\n")}
<script>
(function() {
  var done = false;
  function back() {
    if (done) return;
    done = true;
    try { window.close(); } catch (e) {}
    if (!window.closed) {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.replace(${backHrefSafe});
      }
    }
  }
  window.addEventListener('afterprint', back);
  try {
    var mq = window.matchMedia('print');
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function (e) { if (!e.matches) back(); });
    }
  } catch (e) {}
  // Garde-fou : si rien ne déclenche le retour (Safari iOS qui ferme la
  // share sheet sans afterprint, Sunmi V3 en auto-print qui n'émet pas
  // l'event), on rend la main au bout de N secondes — court sur Sunmi
  // (auto-print = quasi instantané), long ailleurs.
  setTimeout(back, ${isSunmi ? 3000 : 60000});
  // 2 rAF + setTimeout 50ms pour laisser le DOM + les fonts se poser AVANT
  // que le navigateur ne snapshote la page pour le PDF.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      setTimeout(function () {
        try { window.print(); } catch (e) { back(); }
      }, 50);
    });
  });
})();
</script>
</body>
</html>`;

  return new Response(fullHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
