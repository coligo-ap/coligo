"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  fetchMyActiveOrders,
  type ActiveOrderLite,
} from "@/app/(customer)/commandes/actions";
import type { OrderStatus } from "@/lib/types";

// =============================================================================
// BANDEAU « COMMANDES EN COURS » — flotte AU-DESSUS de la bottom-nav (façon
// live pill Uber Eats). Une carte par commande active (1..n commerçants),
// avec le statut et une petite scène VIVANTE : le cuisinier 👨‍🍳 se balance
// sous ses volutes de vapeur pendant la préparation, le sac 🛍️ rebondit quand
// c'est prêt. Tap = détail de la commande.
//
// Données : polling léger (20 s) + resync à la reprise au premier plan
// (useResumeResync) — cache TanStack isolé par utilisateur.
// =============================================================================

const STATUS_BADGE_KEY: Partial<Record<OrderStatus, string>> = {
  pending: "badgePending",
  accepted: "badgeAccepted",
  preparing: "badgePreparing",
  ready: "badgeReady",
};

/** Routes où le bandeau serait redondant ou gênerait un CTA flottant. */
function hiddenOn(p: string): boolean {
  return (
    p.startsWith("/m/") || // CTA « Voir mon panier » flottant au même endroit
    p.startsWith("/panier") ||
    p.startsWith("/checkout") ||
    p.startsWith("/commandes") // la liste / le détail montrent déjà tout
  );
}

export function ActiveOrdersBar({ userId }: { userId: string }) {
  const pathname = usePathname() || "/";
  const hidden = hiddenOn(pathname);

  const { data, refetch } = useQuery({
    queryKey: ["customer-active-orders", userId],
    queryFn: () => fetchMyActiveOrders(),
    placeholderData: keepPreviousData,
    // Poll doux : le statut change côté commerçant, le client doit le voir
    // sans recharger. Coupé sur les routes où le bandeau est masqué.
    refetchInterval: 20_000,
    staleTime: 10_000,
    enabled: !hidden,
  });
  // Timers throttlés en arrière-plan → resync immédiat au retour (règle
  // produit « arrière-plan → reprise »).
  useResumeResync(() => void refetch());

  const orders = data ?? [];
  if (hidden || orders.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-3 pb-2 lg:bottom-4">
      <div
        className={cn(
          "mx-auto max-w-md",
          orders.length > 1 &&
            "scrollbar-hide flex snap-x snap-mandatory gap-2 overflow-x-auto"
        )}
      >
        {orders.map((o) => (
          <ActiveOrderCard key={o.id} order={o} multi={orders.length > 1} />
        ))}
      </div>
    </div>
  );
}

function ActiveOrderCard({
  order,
  multi,
}: {
  order: ActiveOrderLite;
  multi: boolean;
}) {
  const t = useTranslations("orders");
  const preparing = order.status === "accepted" || order.status === "preparing";
  const ready = order.status === "ready";

  return (
    <Link
      href={`/commandes/${order.id}`}
      className={cn(
        "border-border bg-surface pointer-events-auto flex items-center gap-3 rounded-[14px] border p-2.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.35)] transition-transform active:scale-[0.98]",
        multi ? "w-[86%] shrink-0 snap-start" : "flex w-full"
      )}
    >
      {/* Scène animée selon le statut. */}
      <span className="bg-primary-50 dark:bg-primary-950/40 relative grid size-11 shrink-0 place-items-center rounded-full">
        {preparing ? (
          <>
            {/* Volutes de vapeur au-dessus du cuisinier. */}
            <span
              aria-hidden
              className="absolute -top-1.5 flex items-end gap-[3px]"
            >
              <span className="co-steam bg-subtle/70 h-[7px] w-[2.5px] rounded-full" />
              <span className="co-steam bg-subtle/70 h-[10px] w-[2.5px] rounded-full" />
              <span className="co-steam bg-subtle/70 h-[7px] w-[2.5px] rounded-full" />
            </span>
            <span className="co-chef text-[22px]" aria-hidden>
              👨‍🍳
            </span>
          </>
        ) : ready ? (
          <span className="co-ready-bounce text-[20px]" aria-hidden>
            🛍️
          </span>
        ) : (
          <span className="animate-pulse text-[20px]" aria-hidden>
            🕒
          </span>
        )}
      </span>

      {/* Commerçant + statut (les libellés réutilisent les badges i18n). */}
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-[13.5px] font-bold">
          {order.merchant_name}
          {order.order_number ? ` · #${order.order_number}` : ""}
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-[12px] font-semibold",
            ready
              ? "text-success-700"
              : preparing
                ? "text-primary-700"
                : "text-muted"
          )}
        >
          {t(STATUS_BADGE_KEY[order.status] ?? "badgePending")}
          {preparing && (
            <span aria-hidden>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
            </span>
          )}
        </span>
      </span>

      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
    </Link>
  );
}
