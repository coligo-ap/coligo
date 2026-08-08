import { createClient } from "@/lib/supabase/server";
import { TrendingUp } from "lucide-react";
import { OrdersCacheSync } from "@/components/merchant/orders-cache-sync";
import { OrderBoard } from "@/components/merchant/order-board";
import { ScheduledOrders } from "@/components/merchant/scheduled-orders";
import { MerchantBalancePill } from "@/components/merchant/balance-pill";
import { formatDA } from "@/lib/utils";
import { isUpcoming } from "@/lib/orders/scheduled";
import { type OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * DASHBOARD = centre de pilotage live. Bandeau résumé du jour en haut +
 * BOARD opérationnel (À confirmer → En préparation → Prêtes) où l'on fait
 * avancer chaque commande d'un tap. Pensé pour gérer beaucoup de commandes/jour.
 * Le board se rafraîchit via `OrderRealtimeBridge` (router.refresh()).
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // PERF : lookup merchant ∥ auto-refus (mig 0244, RPC scopée session — le
  // wrapper résout merchant_id tout seul) → un aller-retour séquentiel de
  // moins sur l'accueil. L'auto-refus reste AVANT la lecture des commandes
  // (compteurs exacts). Best-effort : n'échoue jamais le rendu du board.
  const [{ data: merchant }] = await Promise.all([
    supabase
      .from("merchants")
      .select("id, name, orders_paused, prep_time_min")
      .eq("user_id", user?.id ?? "")
      .maybeSingle(),
    supabase.rpc("expire_my_stale_pending_orders" as never).then(
      () => {},
      () => {}
    ),
  ]);
  const prepTimeMin =
    (merchant as { prep_time_min?: number } | null)?.prep_time_min ?? 0;

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id, merchant_id, customer_name, customer_phone, status,
      total_da, pickup_code, order_number, pickup_type, pickup_slot_at, notes, created_at,
      payment_method, payment_status, fulfillment_type, delivery_mode,
      delivery_driver_id, delivery_picked_up_at, delivery_arrived_at,
      delivery_delivered_at,
      order_items (
        id, order_id, product_name, unit_price_da, quantity, line_total_da
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-control border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement : {error.message}
        </div>
      </div>
    );
  }

  // Anti-fraude : masquer pickup_code des livraisons côté commerçant.
  const ordersList = (
    (orders ?? []) as unknown as (OrderWithItems & {
      fulfillment_type?: string;
    })[]
  ).map((o) =>
    o.fulfillment_type === "delivery"
      ? ({ ...o, pickup_code: "" } as OrderWithItems)
      : (o as OrderWithItems)
  );

  // Commandes ACTIVES pour le board (le reste = historique sur /orders).
  const activeOrders = ordersList.filter((o) =>
    ["pending", "accepted", "preparing", "ready"].includes(o.status)
  );

  // Programmées (créneau futur) : retirées de la file active tant que la « fire
  // time » (pickup_slot_at − prep) n'est pas atteinte → le commerçant ne les
  // prépare pas trop tôt. Bascule DÉRIVÉE : dès que l'heure passe, l'ordre
  // réapparaît dans le board au rafraîchissement suivant (zéro minuterie).
  const now = new Date();
  const upcomingOrders = activeOrders
    .filter((o) =>
      isUpcoming(
        o as unknown as { pickup_type?: string; pickup_slot_at?: string },
        prepTimeMin,
        now
      )
    )
    .sort(
      (a, b) =>
        new Date(a.pickup_slot_at).getTime() -
        new Date(b.pickup_slot_at).getTime()
    );
  const upcomingIds = new Set(upcomingOrders.map((o) => o.id));
  const boardOrders = activeOrders.filter((o) => !upcomingIds.has(o.id));

  // Stats du jour (Algérie : on s'appuie sur l'heure locale du serveur Vercel
  // — suffisant pour le résumé ; le détail comptable est dans Finances).
  const today = new Date();
  const todayOrders = ordersList.filter((o) => {
    const d = new Date(o.created_at);
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  });
  const todayRevenue = todayOrders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total_da, 0);

  return (
    <div className="mx-auto max-w-[1200px] p-4 lg:p-6 lg:px-8">
      <OrdersCacheSync orders={ordersList} />

      {/* Le nom de la boutique + le statut ouvert/fermé + la cloche sont déjà
          dans le header de l'app (topbar desktop / header mobile) — pas de
          doublon ici. On démarre directement sur le résumé du jour. */}

      {/* ─── Bandeau résumé du jour (compact) ───
          Dégradé en `style` inline (variables CSS déjà définies) + couleur
          pleine de secours : les WebView Android anciennes (Sunmi) ne gèrent
          pas le `@property` des dégradés Tailwind v4 → sans ça la carte
          apparaissait transparente en mobile. */}
      <section
        className="bg-primary-600 rounded-sheet-lg mb-5 flex flex-wrap items-center justify-between gap-4 p-4 text-white lg:p-5"
        style={{
          backgroundImage:
            "linear-gradient(to bottom right, var(--color-primary-600), var(--color-primary-700))",
        }}
      >
        <div className="flex items-center gap-4 lg:gap-6">
          <div>
            <p className="text-primary-100 inline-flex items-center gap-1.5 text-xs font-medium">
              <TrendingUp className="size-3.5" />
              Gagné aujourd&apos;hui
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums lg:text-4xl">
              {formatDA(todayRevenue)}
            </p>
          </div>
          <div className="border-l border-white/20 pl-4 lg:pl-6">
            <p className="text-primary-100 text-xs font-medium">Commandes</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums lg:text-4xl">
              {todayOrders.length}
            </p>
          </div>
        </div>
        {/* Wallet Coligo Pay (remplace l'ancien bouton du header) → solde +
            recharge. */}
        <MerchantBalancePill variant="banner" />
      </section>

      {/* ─── Commandes programmées (à venir) ─── */}
      <ScheduledOrders orders={upcomingOrders} prepTimeMin={prepTimeMin} />

      {/* ─── Board opérationnel live ─── */}
      <OrderBoard orders={boardOrders} />
    </div>
  );
}
