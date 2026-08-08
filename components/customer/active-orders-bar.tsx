"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Bike,
  Car,
  ChefHat,
  ChevronRight,
  CreditCard,
  MapPin,
  Package,
  Pencil,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LottieScene } from "@/components/ui/lottie";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  fetchMyActiveOrders,
  type ActiveOrderLite,
} from "@/app/(customer)/commandes/actions";
import {
  fetchMyActiveRideLite,
  type ActiveRideLite,
} from "@/app/(customer)/drive/actions";
import type { OrderStatus } from "@/lib/types";
import { writeOfflineSnapshot } from "@/lib/native/offline-snapshot";

// =============================================================================
// BANDEAU « COMMANDES EN COURS » — flotte AU-DESSUS de la bottom-nav (façon
// live pill Uber Eats). Une carte par commande active (1..n commerçants), avec
// une SCÈNE ANIMÉE spécifique à chaque situation (icônes lucide + CSS, JAMAIS
// d'emoji en dur — règle produit ; 0 KB de dépendance, pas de Lottie ni
// d'assets réseau, léger et offline-safe APK) :
//   - en attente   : le commerçant « écrit » la commande (stylo sur ticket) ;
//   - préparation  : le cuisinier travaille (vapeur) pendant qu'un ingrédient
//                    tombe dans le colis qui tressaute (on emballe !) ;
//   - prête retrait: sac qui rebondit + étincelle ;
//   - en livraison : moto (express) ou fourgon (tournée) qui roule, traits de
//                    vitesse défilants (sens inversé en RTL).
// Tap = détail de la commande. X = fermer la carte : mémorisé par
// (commande, statut) en sessionStorage → elle RÉAPPARAÎT dès que le statut
// change (le client ne rate jamais « prête » ou « en livraison »).
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

/**
 * Libellé d'une commande active. Factorisé parce qu'il sert à DEUX endroits :
 * la carte du bandeau, et l'instantané natif lu par l'écran hors-ligne. Les
 * deux doivent dire exactement la même chose.
 */
function activeOrderLabel(
  order: ActiveOrderLite,
  t: (key: string) => string
): string {
  const delivering =
    order.status === "ready" && order.fulfillment_type === "delivery";
  return delivering
    ? t("activeDelivering")
    : t(STATUS_BADGE_KEY[order.status] ?? "badgePending");
}

const DISMISS_KEY = "coligo:active-orders-dismissed";

function readDismissed(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(DISMISS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

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
  const t = useTranslations("orders");

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
  // Course Drive active — même bandeau : le client sur la marketplace voit
  // sa recherche de chauffeur / sa course en cours d'un coup d'œil. Masquée
  // sur /drive (l'écran course montre déjà tout, en mieux).
  const onDrive = pathname.startsWith("/drive");
  const { data: ride, refetch: refetchRide } = useQuery({
    queryKey: ["customer-active-ride-lite", userId],
    queryFn: () => fetchMyActiveRideLite(),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
    staleTime: 10_000,
    enabled: !hidden && !onDrive,
  });
  // Timers throttlés en arrière-plan → resync immédiat au retour (règle
  // produit « arrière-plan → reprise »).
  useResumeResync(() => {
    void refetch();
    void refetchRide();
  });

  // Fermeture par carte : mémorisée par (id → statut) pour la session. Si le
  // statut évolue (préparation → prête), la carte REVIENT automatiquement.
  const [dismissed, setDismissed] =
    useState<Record<string, string>>(readDismissed);
  const dismiss = useCallback((id: string, status: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [id]: status };
      try {
        window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      } catch {
        /* stockage indisponible : fermeture non persistée, sans gravité */
      }
      return next;
    });
  }, []);

  // Miroir natif pour l'écran hors-ligne de l'APK (server.errorPath). On écrit
  // les commandes BRUTES, pas la liste filtrée par `dismissed` : fermer une
  // carte est un geste d'affichage, pas la disparition de la commande.
  // `data === undefined` = requête pas encore résolue → on n'écrase rien.
  useEffect(() => {
    if (!data) return;
    void writeOfflineSnapshot(
      data.map((o) => ({
        number: o.order_number,
        label: activeOrderLabel(o, t),
        merchant: o.merchant_name,
        fulfillment: o.fulfillment_type,
      }))
    );
  }, [data, t]);

  const orders = (data ?? []).filter((o) => dismissed[o.id] !== o.status);
  // La course Drive suit la même mécanique de fermeture (id → statut) — la
  // carte revient dès que le statut évolue (accepté, arrivé…).
  const activeRide =
    !onDrive && ride && dismissed[ride.id] !== ride.status ? ride : null;
  const total = orders.length + (activeRide ? 1 : 0);
  if (hidden || total === 0) return null;
  const multi = total > 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-30 px-3 pb-1.5 lg:bottom-4">
      <div
        className={cn(
          "mx-auto max-w-md",
          multi &&
            "scrollbar-hide flex snap-x snap-mandatory gap-2 overflow-x-auto"
        )}
      >
        {/* La course d'ABORD : c'est l'événement le plus « temps réel »
            (un chauffeur arrive) — puis les commandes commerçants. */}
        {activeRide && (
          <ActiveRideCard
            ride={activeRide}
            multi={multi}
            onDismiss={() => dismiss(activeRide.id, activeRide.status)}
          />
        )}
        {orders.map((o) => (
          <ActiveOrderCard
            key={o.id}
            order={o}
            multi={multi}
            onDismiss={() => dismiss(o.id, o.status)}
          />
        ))}
      </div>
    </div>
  );
}

/** Libellé i18n du statut d'une course (namespace orders.ride*). */
function rideStatusKey(ride: ActiveRideLite): string {
  if (ride.awaiting_payment) return "rideAwaitingPayment";
  switch (ride.status) {
    case "scheduled":
      return "rideScheduled";
    case "accepted":
      return "rideAccepted";
    case "arriving":
      return "rideArriving";
    case "arrived":
      return "rideArrived";
    case "in_progress":
      return "rideInProgress";
    default:
      return "rideSearching";
  }
}

/** Carte COURSE DRIVE du bandeau — même gabarit que les commandes, teinte
 *  violette Drive, scène voiture animée (lucide + CSS, repli-first). */
function ActiveRideCard({
  ride,
  multi,
  onDismiss,
}: {
  ride: ActiveRideLite;
  multi: boolean;
  onDismiss: () => void;
}) {
  const t = useTranslations("orders");
  const searching = ride.status === "searching" && !ride.awaiting_payment;
  const arrived = ride.status === "arrived";
  const moving =
    ride.status === "accepted" ||
    ride.status === "arriving" ||
    ride.status === "in_progress";

  return (
    <Link
      href="/drive"
      className={cn(
        "border-border bg-surface rounded-card-lg pointer-events-auto relative flex items-center gap-3 border p-2.5 pe-8 transition-transform active:scale-[0.98]",
        multi ? "w-[86%] shrink-0 snap-start" : "flex w-full"
      )}
    >
      {/* Scène : voiture + traits de vitesse (en mouvement), halo pulsé
          (recherche), étincelle (chauffeur sur place). */}
      <span className="bg-primary-50 dark:bg-primary-950/40 relative grid size-11 shrink-0 place-items-center overflow-visible rounded-full">
        {searching && (
          <span
            aria-hidden
            className="border-primary-400/60 absolute inset-0 animate-ping rounded-full border-2"
          />
        )}
        {moving && (
          <span
            aria-hidden
            className="absolute start-0.5 top-1/2 flex -translate-y-1/2 flex-col gap-[3px]"
          >
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[7px] rounded-full" />
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[10px] rounded-full" />
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[6px] rounded-full" />
          </span>
        )}
        <span className={moving ? "co-drive" : undefined} aria-hidden>
          {ride.awaiting_payment ? (
            <CreditCard className="text-warning-500 size-5" />
          ) : (
            <Car className="text-primary-700 size-5 rtl:-scale-x-100" />
          )}
        </span>
        {arrived && (
          <span aria-hidden className="co-sparkle absolute end-0 -top-0.5">
            <Sparkles className="text-warning-500 size-3" />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="text-foreground text-body flex items-center gap-1.5 truncate font-bold">
          <span className="text-primary-700 font-black">{t("rideTitle")}</span>
          {ride.dest_text && (
            <span className="text-muted text-label inline-flex min-w-0 items-center gap-0.5 font-semibold">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{ride.dest_text}</span>
            </span>
          )}
        </span>
        <span
          className={cn(
            "text-label mt-0.5 block truncate font-semibold",
            ride.awaiting_payment
              ? "text-warning-600"
              : arrived
                ? "text-success-700"
                : "text-primary-700"
          )}
        >
          {ride.chauffeur_name && !searching && !ride.awaiting_payment
            ? `${ride.chauffeur_name} · `
            : ""}
          {t(rideStatusKey(ride))}
          {(searching || moving) && (
            <span aria-hidden>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
            </span>
          )}
        </span>
      </span>

      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />

      <span
        role="button"
        tabIndex={0}
        aria-label={t("activeDismiss")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onDismiss();
          }
        }}
        className="bg-surface-3 text-muted hover:text-foreground absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-[var(--color-border)] shadow-sm"
      >
        <X className="size-3" />
      </span>
    </Link>
  );
}

function ActiveOrderCard({
  order,
  multi,
  onDismiss,
}: {
  order: ActiveOrderLite;
  multi: boolean;
  onDismiss: () => void;
}) {
  const t = useTranslations("orders");
  const preparing = order.status === "accepted" || order.status === "preparing";
  const ready = order.status === "ready";
  const delivering = ready && order.fulfillment_type === "delivery";

  // Libellé : badges i18n existants, sauf « en livraison » (clé dédiée).
  // Même source que l'instantané hors-ligne — cf. activeOrderLabel().
  const label = activeOrderLabel(order, t);

  return (
    <Link
      href={`/commandes/${order.id}`}
      className={cn(
        "border-border bg-surface rounded-card-lg pointer-events-auto relative flex items-center gap-3 border p-2.5 pe-8 transition-transform active:scale-[0.98]",
        multi ? "w-[86%] shrink-0 snap-start" : "flex w-full"
      )}
    >
      <StatusScene order={order} />

      {/* Commerçant + statut. */}
      <span className="min-w-0 flex-1">
        <span className="text-foreground text-body block truncate font-bold">
          {/* N° de commande EN PREMIER (côté gauche/start), bien visible. */}
          {order.order_number && (
            <span className="text-primary-700 me-1.5 font-black">
              #{order.order_number}
            </span>
          )}
          {order.merchant_name}
        </span>
        <span
          className={cn(
            "text-label mt-0.5 block truncate font-semibold",
            ready
              ? "text-success-700"
              : preparing
                ? "text-primary-700"
                : "text-muted"
          )}
        >
          {label}
          {(preparing || delivering) && (
            <span aria-hidden>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
              <span className="co-dot">.</span>
            </span>
          )}
        </span>
      </span>

      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />

      {/* Fermer la carte (par statut : elle revient si le statut change).
          span role=button : un <button> dans un <Link> = HTML invalide →
          échec d'hydratation React. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={t("activeDismiss")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onDismiss();
          }
        }}
        className="bg-surface-3 text-muted hover:text-foreground absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-[var(--color-border)] shadow-sm"
      >
        <X className="size-3" />
      </span>
    </Link>
  );
}

/**
 * Scène animée du statut — ILLUSTRATION LOTTIE (public/lottie/*.json, locaux)
 * avec REPLI icônes lucide + CSS : le repli s'affiche pendant le chargement,
 * si le fichier manque/échoue, ou si prefers-reduced-motion. JAMAIS d'emoji
 * en dur (règle produit). Chaque cas a sa scène (préparation ≠ prête retrait
 * ≠ express ≠ tournée).
 */
function StatusScene({ order }: { order: ActiveOrderLite }) {
  const preparing = order.status === "accepted" || order.status === "preparing";
  const ready = order.status === "ready";
  const delivering = ready && order.fulfillment_type === "delivery";

  const lottieSrc = delivering
    ? order.delivery_mode === "tour"
      ? "/lottie/tour.json"
      : "/lottie/express.json"
    : preparing
      ? "/lottie/preparing.json"
      : ready
        ? "/lottie/ready.json"
        : "/lottie/pending.json";

  return (
    <span className="bg-primary-50 dark:bg-primary-950/40 relative grid size-11 shrink-0 place-items-center overflow-visible rounded-full">
      <LottieScene
        src={lottieSrc}
        className={cn(
          "absolute inset-0.5",
          // Les véhicules « roulent » vers la droite dans les fichiers → on
          // inverse en RTL pour qu'ils aillent vers le lecteur.
          delivering && "rtl:-scale-x-100"
        )}
        fallback={<StatusSceneFallback order={order} />}
      />
    </span>
  );
}

/** Repli icônes/CSS des scènes (aussi affiché pendant le chargement Lottie). */
function StatusSceneFallback({ order }: { order: ActiveOrderLite }) {
  const preparing = order.status === "accepted" || order.status === "preparing";
  const ready = order.status === "ready";
  const delivering = ready && order.fulfillment_type === "delivery";

  return (
    <>
      {delivering ? (
        // ─── EN LIVRAISON : moto (express) / fourgon (tournée) qui roule ────
        <>
          <span
            aria-hidden
            className="absolute start-0.5 top-1/2 flex -translate-y-1/2 flex-col gap-[3px]"
          >
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[7px] rounded-full" />
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[10px] rounded-full" />
            <span className="co-speedline bg-primary-400/70 h-[2px] w-[6px] rounded-full" />
          </span>
          <span className="co-drive" aria-hidden>
            {order.delivery_mode === "tour" ? (
              <Truck className="text-primary-700 size-5 rtl:-scale-x-100" />
            ) : (
              <Bike className="text-primary-700 size-5 rtl:-scale-x-100" />
            )}
          </span>
          {/* La route. */}
          <span
            aria-hidden
            className="bg-subtle/40 absolute bottom-1.5 h-[2px] w-6 rounded-full"
          />
        </>
      ) : preparing ? (
        // ─── EN PRÉPARATION : la toque s'active sous la vapeur, un
        //     ingrédient tombe dans le colis qui tressaute (on emballe). ────
        <>
          <span
            aria-hidden
            className="absolute start-2.5 -top-1.5 flex items-end gap-[3px]"
          >
            <span className="co-steam bg-primary-300/80 h-[6px] w-[2px] rounded-full" />
            <span className="co-steam bg-primary-300/80 h-[9px] w-[2px] rounded-full" />
            <span className="co-steam bg-primary-300/80 h-[6px] w-[2px] rounded-full" />
          </span>
          <span className="co-chef absolute start-1.5 top-1.5" aria-hidden>
            <ChefHat className="text-primary-700 size-[18px]" />
          </span>
          {/* Ingrédient qui tombe dans le colis. */}
          <span
            aria-hidden
            className="co-pack-item bg-accent-500 absolute end-2.5 top-2.5 size-[5px] rounded-full"
          />
          <span className="co-pack-box absolute end-1 bottom-1" aria-hidden>
            <Package className="text-primary-600 size-4" />
          </span>
        </>
      ) : ready ? (
        // ─── PRÊTE (retrait) : le sac rebondit, ça scintille. ───────────────
        <>
          <span className="co-ready-bounce" aria-hidden>
            <ShoppingBag className="text-success-600 size-5" />
          </span>
          <span aria-hidden className="co-sparkle absolute end-0 -top-0.5">
            <Sparkles className="text-warning-500 size-3" />
          </span>
        </>
      ) : (
        // ─── EN ATTENTE : le commerçant « écrit » la commande. ─────────────
        <>
          <ReceiptText aria-hidden className="text-primary-700 size-5" />
          <span aria-hidden className="co-pen absolute end-1 bottom-1">
            <Pencil className="text-accent-500 size-3" />
          </span>
        </>
      )}
    </>
  );
}
