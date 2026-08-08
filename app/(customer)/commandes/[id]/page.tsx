import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  Check,
  Clock,
  MapPin,
  PackageCheck,
  Truck,
  X,
} from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { type OrderStatus } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { CustomerOrderLive } from "@/components/customer/customer-order-live";
import { OrderPlacedCelebration } from "@/components/customer/order-celebration";
import { OrderCallListener } from "@/components/customer/order-call-listener";
import { OrderShareCard } from "@/components/customer/referral/order-share-card";
import { getMyReferralOverview } from "@/lib/referral/overview";
import { getShareStorySettings } from "@/lib/data/share-story";
import { OrderPurchaseTracking } from "@/components/analytics/order-purchase-tracking";
import { CancelOrderButton } from "@/components/customer/cancel-order-button";
import { ReorderButton } from "@/components/customer/reorder-button";
import { OrderTrack } from "@/components/customer/order-track";
import { PaymentLine } from "@/components/customer/payment-line";
import { CustomerDeliveryMap } from "@/components/customer/customer-delivery-map";
import { ConfirmReception } from "@/components/customer/confirm-reception";
import { ReportDriver } from "@/components/customer/report-driver";
import { OrderChat } from "@/components/chat/order-chat";
import { QrZoom } from "@/components/shared/qr-zoom";
import { LottieScene } from "@/components/ui/lottie";
import { DriverReviewCard } from "@/components/customer/driver-review-card";
import { OrderSupportButton } from "@/components/support/order-support-button";
import { estimateDeliveryEtaMin } from "@/lib/delivery/eta";
import { cldUrl } from "@/lib/images/cloudinary";
import { formatAsapReady, formatSlotRange } from "@/lib/customer/pickup-format";
import { formatQtyUnit } from "@/lib/ticket/ticket-format";

export const dynamic = "force-dynamic";

export default async function CustomerOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const { id } = await params;
  const { placed } = await searchParams;
  const t = await getTranslations("orders");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/se-connecter?next=/commandes/${id}`);

  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, status, payment_method, payment_status, pickup_code, order_number, pickup_type,
       pickup_slot_at, pickup_slot_start, pickup_slot_end, customer_note,
       subtotal_da, discount_da, cashback_estimate_da, cashback_used_da, topup_used_da, total_da, created_at,
       merchant_id,
       fulfillment_type, delivery_mode, delivery_fee_da, delivery_distance_km,
       delivery_driver_id,
       delivery_address_text, delivery_picked_up_at, delivery_arrived_at, delivery_delivered_at,
       delivery_lat, delivery_lng,
       driver_live_lat, driver_live_lng, driver_live_at,
       merchants ( name, slug, logo_url, phone_public, address, commune, prep_time_min ),
       order_items ( id, product_name, unit, unit_price_da, quantity, line_total_da )`
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  // UX : une commande online jamais payée n'a pas à apparaître côté client.
  // Si le paiement a échoué (status='cancelled' + payment_status='failed'),
  // on renvoie vers la page d'échec dédiée. Si elle est encore pending
  // (Chargily pas encore notifié), on renvoie aussi vers la page d'attente
  // (success) qui affichera "Paiement en cours de confirmation" et watchera.
  if (order.payment_method === "online" && order.payment_status !== "paid") {
    if (order.payment_status === "failed") {
      redirect(`/checkout/failure?order_id=${order.id}`);
    }
    if (order.payment_status === "pending") {
      redirect(`/checkout/success?order_id=${order.id}`);
    }
  }

  const merchant = (
    order as unknown as {
      merchants: {
        name: string;
        slug: string;
        logo_url: string | null;
        phone_public: string | null;
        address: string | null;
        commune: string | null;
        prep_time_min: number | null;
      };
    }
  ).merchants;

  const items =
    (
      order as unknown as {
        order_items: {
          id: string;
          product_name: string;
          unit: string | null;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        }[];
      }
    ).order_items ?? [];

  const status = order.status as OrderStatus;
  const isCash = order.payment_method === "cash";
  const isDelivery = order.fulfillment_type === "delivery";
  const isCancelled = status === "cancelled";
  const isCompleted = status === "completed";

  // Preuve de dépôt (no-show en ligne « livré à l'adresse », mig 0328). Colonnes
  // pas encore dans les types générés → requête castée séparée (ne casse pas le
  // typage de la commande principale).
  const proofFrom = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{
          data: {
            delivery_no_show_kind: string | null;
            delivery_proof_url: string | null;
            delivery_proof_note: string | null;
          } | null;
        }>;
      };
    };
  };
  const { data: proofRow } = await proofFrom("orders")
    .select("delivery_no_show_kind, delivery_proof_url, delivery_proof_note")
    .eq("id", order.id)
    .maybeSingle();
  const noShowProof =
    proofRow?.delivery_no_show_kind === "left_at_door" &&
    proofRow?.delivery_proof_url
      ? {
          url: proofRow.delivery_proof_url,
          note: proofRow.delivery_proof_note,
        }
      : null;

  // Reçu de paiement (mig 0394) : fournisseur, carte, statut, horodatage.
  // Lu avec le client du CLIENT (pas service_role) : la policy RLS
  // payment_receipts_own_select garantit qu'il ne voit que les siens.
  const receiptFrom = supabase.from.bind(supabase) as unknown as (
    t: string
  ) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{
            data:
              | {
                  provider: "stripe" | "chargily";
                  card_brand: string | null;
                  card_last4: string | null;
                  wallet: string | null;
                  method: string | null;
                  status: "paid" | "failed" | "refunded";
                  paid_at: string | null;
                }[]
              | null;
          }>;
        };
      };
    };
  };
  const { data: receiptRows } = await receiptFrom("payment_receipts")
    .select("provider, card_brand, card_last4, wallet, method, status, paid_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const receipt = receiptRows?.[0] ?? null;

  // Anti-fraude : un client qui a déjà été remboursé plusieurs fois sur des
  // annulations online (30 j) ne peut plus annuler cette commande payée en
  // ligne — il doit la récupérer. (La RLS limite le décompte à SES commandes ;
  // l'enforcement réel est dans la RPC cancel_order_by_customer.)
  let onlineRefundBlocked = false;
  if (
    status === "pending" &&
    order.payment_method === "online" &&
    order.payment_status === "paid"
  ) {
    const { data: ps } = await supabase
      .from("platform_settings")
      .select("max_online_refund_cancels_30d")
      .eq("id", true)
      .maybeSingle();
    const cap =
      (ps as { max_online_refund_cancels_30d: number } | null)
        ?.max_online_refund_cancels_30d ?? 3;
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const baseQuery = supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", "online")
      .eq("payment_status", "refunded")
      .gte("created_at", since);
    // `cancelled_by` n'est pas encore dans database.types.ts généré → cast local.
    const { count } = await (
      baseQuery as unknown as {
        eq: (c: string, v: string) => PromiseLike<{ count: number | null }>;
      }
    ).eq("cancelled_by", "customer");
    onlineRefundBlocked = (count ?? 0) >= cap;
  }

  // Notation du livreur : commande livrée + livreur assigné.
  const driverId = (order as { delivery_driver_id: string | null })
    .delivery_driver_id;
  let driverReview: { name: string; rating: number | null } | null = null;
  if (isCompleted && driverId) {
    const [{ data: drv }, { data: rev }] = await Promise.all([
      supabase
        .from("drivers")
        .select("full_name")
        .eq("id", driverId)
        .maybeSingle(),
      supabase
        .from("driver_reviews")
        .select("rating")
        .eq("order_id", order.id)
        .maybeSingle(),
    ]);
    driverReview = {
      name: drv?.full_name?.split(" ")[0] ?? t("yourDriver"),
      rating: rev?.rating ?? null,
    };
  }

  // Quand le code de retrait est-il utile au client ?
  //  - Code PIN requis UNIQUEMENT pour le payé EN LIGNE (retrait OU livraison) :
  //    c'est une sécurité car déjà payé, le client le remet à la personne.
  //  - En CASH, aucun code — le client paie en espèces et donne juste son
  //    NUMÉRO DE COMMANDE.
  // Le PIN ne s'affiche QUE côté client, jamais imprimé, jamais visible
  // commerçant/livreur.
  // Le code est requis dès qu'il y a la MOINDRE part PRÉPAYÉE : payé en ligne
  // (Chargily), OU cashback utilisé, OU Coligo Pay utilisé. Seule une commande
  // 100 % espèces (rien de prépayé) n'a pas de code. ⟹ cohérent avec la RPC
  // validate_delivery (mig 0090) côté livreur.
  const cashbackUsed =
    (order as { cashback_used_da: number | null }).cashback_used_da ?? 0;
  const topupUsed =
    (order as { topup_used_da: number | null }).topup_used_da ?? 0;
  const needsCode =
    order.payment_method === "online" || cashbackUsed > 0 || topupUsed > 0;

  // Livraison EN COURS = récupérée par le livreur et pas encore livrée. On
  // affiche alors la mini-carte de suivi live (position du livreur + ETA).
  const inTransit =
    isDelivery &&
    order.delivery_picked_up_at != null &&
    order.delivery_delivered_at == null &&
    !isCompleted &&
    !isCancelled;
  const destLat = (order as { delivery_lat: number | null }).delivery_lat;
  const destLng = (order as { delivery_lng: number | null }).delivery_lng;
  const liveDriver =
    (order as { driver_live_lat: number | null }).driver_live_lat != null &&
    (order as { driver_live_lng: number | null }).driver_live_lng != null
      ? {
          lat: (order as { driver_live_lat: number }).driver_live_lat,
          lng: (order as { driver_live_lng: number }).driver_live_lng,
          at: (order as { driver_live_at: string | null }).driver_live_at,
        }
      : null;

  // Contact du livreur (prénom + tél) pour la barre de la mini-carte. Lecture
  // sécurisée via la RPC SECURITY DEFINER (le client ne lit QUE le livreur de
  // SA commande — cf. migration 0066), sans ouvrir la table `drivers`.
  let driverContact: {
    first_name: string | null;
    phone: string | null;
  } | null = null;
  if (inTransit && driverId) {
    const { data: dc } = await supabase.rpc("order_driver_contact", {
      p_order_id: order.id,
    });
    driverContact = Array.isArray(dc) ? (dc[0] ?? null) : (dc ?? null);
  }

  // ETA livraison (préparation + le livreur va chercher + trajet client).
  const etaMin = isDelivery
    ? estimateDeliveryEtaMin({
        status,
        pickedUpAt: order.delivery_picked_up_at as string | null,
        createdAt: order.created_at,
        prepMinutes: merchant.prep_time_min ?? 10,
        distanceKm:
          (order as { delivery_distance_km: number | null })
            .delivery_distance_km ?? null,
      })
    : null;

  // ─── État résumé du bloc principal (statut d'un coup d'œil) ───
  const orderNumber = (order as { order_number: string | null }).order_number;

  type Tone = "violet" | "green" | "red";
  const stateTone: Tone = isCancelled
    ? "red"
    : isCompleted || inTransit
      ? "green"
      : "violet";
  const StateIcon = isCancelled
    ? X
    : isCompleted
      ? Check
      : inTransit
        ? Truck
        : Clock;

  // Scène ANIMÉE du statut (Lottie locale, repli = icône) — même langage que
  // le bandeau de suivi : cuisine (préparation), sac (prête retrait), véhicule
  // (livreur attendu / en route). États terminaux = icône statique.
  const vehicleScene =
    !isCancelled &&
    !isCompleted &&
    (inTransit || (isDelivery && status === "ready"));
  const sceneSrc =
    isCancelled || isCompleted
      ? null
      : vehicleScene
        ? order.delivery_mode === "tour"
          ? "/lottie/tour.json"
          : "/lottie/express.json"
        : status === "ready"
          ? "/lottie/ready.json"
          : status === "preparing" || status === "accepted"
            ? "/lottie/preparing.json"
            : "/lottie/pending.json";

  const stateTitle = isCancelled
    ? t("stateTitleCancelled")
    : isCompleted
      ? isDelivery
        ? t("stateTitleDelivered")
        : t("stateTitlePickedUp")
      : inTransit
        ? t("stateTitleInDelivery")
        : status === "ready"
          ? isDelivery
            ? t("stateTitleReadyWaitingDriver")
            : t("stateTitleReadyPickup")
          : status === "preparing" || status === "accepted"
            ? t("stateTitlePreparing")
            : t("stateTitleSent");

  const driverFirst = driverContact?.first_name?.trim() || t("theDriver");
  const stateSub = isCancelled
    ? t("stateSubCancelled")
    : isCompleted
      ? t("stateSubCompleted")
      : inTransit
        ? t("stateSubArrivingSoon", { name: driverFirst })
        : status === "ready"
          ? isDelivery
            ? t("stateSubWaitingDriver")
            : t("stateSubPickupInStore")
          : status === "preparing" || status === "accepted"
            ? t("stateSubPreparing")
            : t("stateSubWaitingMerchant");

  // ─── Délai affiché à gauche de la ligne montant (label + valeur en gras) ───
  const isSlot =
    !isDelivery &&
    order.pickup_type === "slot" &&
    order.pickup_slot_start != null &&
    order.pickup_slot_end != null;
  // Préparation restante (retrait ASAP) en minutes.
  const elapsedMin = Math.floor(
    (Date.now() - new Date(order.created_at).getTime()) / 60_000
  );
  const prepRemaining = Math.max(
    1,
    (merchant.prep_time_min ?? 10) - elapsedMin
  );

  // RÈGLE PRODUIT (cf. CLAUDE.md) : cette ligne n'existe que si elle APPORTE
  // une info (ETA, créneau, arrivée) — jamais une répétition du titre d'état.
  // « Prête à récupérer » / « Récupérée » apparaissaient 3× sur la page
  // (titre + tracker + ici) → supprimés ici, le titre dit déjà tout.
  let delai: { Icon: typeof Clock; label: string; strong?: string } | null =
    null;
  if (!isCancelled && !isCompleted) {
    if (isDelivery) {
      delai = inTransit
        ? {
            Icon: Truck,
            label: t("delaiArrival"),
            strong: etaMin != null ? `~${etaMin} min` : t("delaiOnTheWay"),
          }
        : {
            Icon: Truck,
            label: t("delaiDelivery"),
            strong: etaMin != null ? `~${etaMin} min` : t("delaiPreparing"),
          };
    } else if (status === "ready") {
      delai = null; // le titre « Prête à récupérer » dit déjà tout
    } else if (isSlot) {
      delai = {
        Icon: Clock,
        label: t("delaiPickup"),
        strong: formatSlotRange(
          new Date(order.pickup_slot_start as string),
          new Date(order.pickup_slot_end as string)
        ),
      };
    } else {
      delai = {
        Icon: Clock,
        label: t("delaiReadyMasc"),
        strong: `~${prepRemaining} min`,
      };
    }
  }

  return (
    <CustomerShell>
      {/* Fête « commande envoyée » (cash / paiement au retrait) — one-shot :
          ?placed=1 posé par le checkout, retiré côté client (anti-rejeu).
          L'online a la sienne sur /checkout/success. */}
      <OrderPlacedCelebration
        placed={placed === "1" && !isCancelled}
        title={t("placedTitle")}
        desc={isDelivery ? t("placedDescDelivery") : t("placedDescPickup")}
        closeLabel={t("placedClose")}
      />

      {/* Suivi live (Realtime + polling) : pop-up + son sur changement de statut. */}
      <CustomerOrderLive orderId={order.id} initialStatus={status} />

      {/* Appel in-app entrant du COMMERÇANT (sens unique — le client ne peut
          pas appeler) : écran accepter/refuser + audio Agora. */}
      <OrderCallListener orderId={order.id} merchantName={merchant.name} />

      {/* GA4 — purchase (dédupliqué) sur la page de confirmation. Online non payé
          ne parvient jamais ici (redirige au-dessus) → revenu réel uniquement. */}
      <OrderPurchaseTracking
        orderId={order.id}
        status={status}
        valueDa={order.total_da}
        shippingDa={order.delivery_fee_da ?? 0}
        merchantName={merchant.name}
        lines={items.map((it) => ({
          id: it.product_name,
          name: it.product_name,
          unitPriceDa: it.unit_price_da,
          quantity: it.quantity,
        }))}
      />

      <div className="mx-auto max-w-2xl px-4 pt-3 pb-24 lg:px-6 lg:pt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Link
            href="/commandes"
            className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4 rtl:-scale-x-100" />
            {t("myOrders")}
          </Link>
          <OrderSupportButton
            orderRef={orderNumber}
            label={t("contactSupport")}
            // Incident pendant une livraison EN COURS = prioritaire (le client
            // attend, le livreur roule) → remonté en URGENT côté support.
            priority={inTransit ? "urgent" : "normal"}
            subject={inTransit ? "Livraison en cours" : "Commande"}
            attributes={{
              Boutique: merchant.name,
              Statut: stateTitle,
              Type: isDelivery ? "Livraison" : "Retrait",
              Paiement: isCash ? "Espèces" : "En ligne (payé)",
              Montant: formatDA(order.total_da),
              ...(isDelivery && order.delivery_address_text
                ? { Adresse: order.delivery_address_text }
                : {}),
              ...(driverContact?.first_name
                ? { Livreur: driverContact.first_name }
                : {}),
            }}
            className="border-border bg-surface text-foreground hover:bg-surface-2 text-label-lg inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-bold transition-colors"
          />
        </div>

        {/* ═══ BLOC PRINCIPAL UNIQUE : statut + suivi horizontal + montant ═══ */}
        <div className="border-border bg-surface rounded-xl border p-4">
          {/* ligne 1 : statut (pastille) + libellé + sous-texte + n° */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "rounded-card relative grid size-12 shrink-0 place-items-center overflow-hidden text-base",
                  stateTone === "green" && "bg-success-50 text-success-700",
                  stateTone === "red" && "bg-danger-50 text-danger-700",
                  stateTone === "violet" && "bg-primary-50 text-primary-700"
                )}
              >
                {sceneSrc ? (
                  <LottieScene
                    src={sceneSrc}
                    className={cn(
                      "absolute inset-0.5",
                      vehicleScene && "rtl:-scale-x-100"
                    )}
                    fallback={<StateIcon className="size-5" />}
                  />
                ) : (
                  <StateIcon className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <b className="text-foreground block truncate text-base leading-tight font-extrabold tracking-tight">
                  {stateTitle}
                </b>
                <small className="text-muted text-caption-lg font-semibold">
                  {stateSub}
                </small>
              </div>
            </div>
            {orderNumber && (
              <span className="shrink-0 text-end">
                <small className="text-muted text-nano-lg block font-bold tracking-wide uppercase">
                  {t("orderNumberShort")}
                </small>
                <b className="text-foreground text-title-lg leading-tight font-black tracking-wide">
                  #{orderNumber}
                </b>
              </span>
            )}
          </div>

          {/* ligne 2 : suivi HORIZONTAL (masqué si annulée) */}
          {!isCancelled && (
            <OrderTrack
              isDelivery={isDelivery}
              status={status}
              pickedUp={order.delivery_picked_up_at != null}
            />
          )}

          {/* ligne 3 : délai (gauche) + montant (droite) */}
          {!isCancelled && (
            <div className="border-border mt-3.5 flex items-center justify-between gap-3 border-t pt-3">
              {delai ? (
                <div className="text-foreground text-label-lg flex items-center gap-1.5 font-semibold">
                  <delai.Icon className="text-primary-600 size-3.5" />
                  <span>
                    {delai.label}
                    {delai.strong && (
                      <>
                        {" "}
                        <b className="text-foreground font-extrabold">
                          {delai.strong}
                        </b>
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <span />
              )}
              <div className="text-end">
                {isCash ? (
                  <>
                    <small className="text-muted text-nano-lg block font-bold tracking-wide uppercase">
                      {t("toPayCash")}
                    </small>
                    <b className="text-foreground text-heading-sm font-black tracking-tight">
                      {formatDA(order.total_da)}
                    </b>
                  </>
                ) : (
                  <>
                    <small className="text-muted text-nano-lg block font-bold tracking-wide uppercase">
                      {t("total")}
                    </small>
                    <b className="text-success-700 text-sm font-black tracking-tight">
                      ✓ {t("paid")} · {formatDA(order.total_da)}
                    </b>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Annulation client — uniquement AVANT acceptation (status pending). */}
          {status === "pending" && (
            <CancelOrderButton
              orderId={order.id}
              paymentMethod={order.payment_method as "cash" | "online"}
              paymentStatus={order.payment_status}
              refundBlocked={onlineRefundBlocked}
            />
          )}

          {/* « Commander à nouveau » — sur une commande terminée ou annulée. */}
          {(isCompleted || isCancelled) && <ReorderButton orderId={order.id} />}
        </div>

        {/* ═══ PARTAGE POST-COMMANDE (mégaphone viral + code parrain) ═══
            Activation + design pilotés par Marketing > Story (mig 0440) ;
            cadeaux ami/partageur = conditions de Marketing > Parrainage. */}
        {isCompleted &&
          (await getShareStorySettings().then(async (share) =>
            share.enabled ? (
              <OrderShareCard
                merchantName={merchant.name}
                design={share.design}
                imageUrl={share.image_url}
                referral={await getMyReferralOverview().then((o) =>
                  o
                    ? {
                        code: o.code,
                        reward_referrer_da: o.reward_referrer_da,
                        reward_referee_da: o.reward_referee_da,
                        min_order_da: o.min_order_da,
                        enabled: o.enabled,
                      }
                    : null
                )}
                appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app"}
              />
            ) : null
          ))}

        {/* ═══ PREUVE DE DÉPÔT (No-Show en ligne) ═══
            Le livreur a déposé la commande à l'adresse après votre absence
            (commande déjà payée en ligne). Photo + commentaire du livreur. */}
        {noShowProof?.url && (
          <div className="border-warning-200 bg-warning-50 mt-2.5 rounded-lg border p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <PackageCheck className="text-warning-700 size-4 shrink-0" />
              <b className="text-warning-800 text-body font-extrabold">
                {t("noShowLeftTitle")}
              </b>
            </div>
            <p className="text-warning-800/90 text-label mb-2.5 leading-relaxed font-medium">
              {t("noShowLeftBody")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={noShowProof.url}
              alt={t("noShowLeftTitle")}
              className="border-warning-200 max-h-72 w-full rounded-md border object-cover"
            />
            {noShowProof.note && (
              <p className="text-foreground rounded-control text-label-lg mt-2.5 bg-white/60 px-3 py-2 font-medium italic">
                « {noShowProof.note} »
              </p>
            )}
          </div>
        )}

        {/* ═══ CODE PIN + QR (payé en ligne : livraison ou retrait) ═══
            Le client le montre/à scanner par le livreur (livraison) ou le
            commerçant (retrait) pour valider. PIN visible client uniquement. */}
        {needsCode && !isCancelled && order.pickup_code && (
          <div className="border-primary-100 bg-primary-50 mt-2.5 rounded-lg border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-primary-800 text-label-lg font-extrabold">
                🔑{" "}
                {isDelivery ? t("codeToGiveDriver") : t("codeToGiveMerchant")}
              </span>
              <span className="text-primary-600 text-[26px] leading-none font-black tracking-[6px] tabular-nums">
                {order.pickup_code}
              </span>
            </div>
            <div className="border-primary-100 mt-3 flex items-center gap-3.5 border-t pt-3">
              <QrZoom
                value={order.pickup_code}
                size={92}
                fullValue={order.pickup_code}
                caption={
                  isDelivery
                    ? t("codeScanHintDriver")
                    : t("codeScanHintMerchant")
                }
              />
              <p className="text-primary-700/90 text-label font-semibold">
                {isDelivery
                  ? t("codeScanHintDriver")
                  : t("codeScanHintMerchant")}
                <span className="text-caption mt-1 block font-bold opacity-80">
                  {t("tapToEnlarge")}
                </span>
              </p>
            </div>
          </div>
        )}

        {/* ═══ MINI-CARTE suivi livreur temps réel (livraison en cours) ═══ */}
        {inTransit && destLat != null && destLng != null && (
          <div className="mt-3">
            <CustomerDeliveryMap
              orderId={order.id}
              destination={{ lat: destLat, lng: destLng }}
              initialDriver={liveDriver}
              initialArrivedAt={order.delivery_arrived_at as string | null}
              driverName={driverContact?.first_name ?? null}
              driverPhone={driverContact?.phone ?? null}
            />
          </div>
        )}

        {/* ═══ GLISSER POUR CONFIRMER LA RÉCEPTION (livreur arrivé) ═══
            Voie de validation côté client : utile si le téléphone du livreur
            est déchargé. N'apparaît qu'une fois le livreur ARRIVÉ. */}
        {inTransit && order.delivery_arrived_at != null && (
          <ConfirmReception
            orderId={order.id}
            labels={{
              title: t("confirmReceptionTitle"),
              slide: t("confirmReceptionSlide"),
              body: t("confirmReceptionBody"),
              confirm: t("confirmReceptionCta"),
              cancel: t("confirmReceptionCancel"),
              success: t("confirmReceptionSuccess"),
            }}
          />
        )}

        {/* ═══ CHAT in-app client ↔ livreur (livraison en cours) ═══ */}
        {inTransit && driverId && (
          <div className="mt-3">
            <OrderChat
              orderId={order.id}
              role="customer"
              phone={driverContact?.phone ?? null}
              phoneLabel={t("callName", {
                name: driverContact?.first_name ?? t("theDriverLower"),
              })}
            />
          </div>
        )}

        {/* ═══ DÉTAIL DE LA COMMANDE ═══ */}
        <div className="border-border bg-surface rounded-sheet-lg mt-3 border p-4">
          <h3 className="text-body-sm mb-2.5 flex items-center justify-between font-extrabold">
            <span>{t("detailTitle")}</span>
            <span className="text-muted text-caption font-semibold">
              {t("itemsCount", { count: items.length })}
            </span>
          </h3>
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-baseline justify-between py-1.5 text-sm"
            >
              <span className="min-w-0 font-semibold">
                <span className="text-primary-600 me-1 font-extrabold">
                  {formatQtyUnit(Number(it.quantity), it.unit)}
                </span>
                {it.product_name}
              </span>
              <span className="shrink-0 ps-2 font-bold tabular-nums">
                {formatDA(it.line_total_da)}
              </span>
            </div>
          ))}

          <hr className="border-border my-2" />
          <div className="text-muted text-body-sm flex items-baseline justify-between py-1 font-semibold">
            <span>{t("subtotal")}</span>
            <span className="tabular-nums">{formatDA(order.subtotal_da)}</span>
          </div>
          {order.discount_da > 0 && (
            <div className="text-success-700 text-body-sm flex items-baseline justify-between py-1 font-semibold">
              <span>{t("promo")}</span>
              <span className="tabular-nums">
                − {formatDA(order.discount_da)}
              </span>
            </div>
          )}
          {isDelivery && order.delivery_fee_da > 0 && (
            <div className="text-muted text-body-sm flex items-baseline justify-between py-1 font-semibold">
              <span>{t("delivery")}</span>
              <span className="tabular-nums">
                {formatDA(order.delivery_fee_da)}
              </span>
            </div>
          )}
          {order.cashback_estimate_da > 0 && (
            <div className="text-primary-700 text-body-sm flex items-baseline justify-between py-1 font-semibold">
              <span>{t("cashbackEstimated")}</span>
              <span className="tabular-nums">
                + {formatDA(order.cashback_estimate_da)}
              </span>
            </div>
          )}
          <div className="text-foreground text-title-sm mt-1 flex items-baseline justify-between border-t border-[var(--color-border)] pt-2 font-black">
            <span>{isCash ? t("total") : t("totalPaid")}</span>
            <span className="tabular-nums">{formatDA(order.total_da)}</span>
          </div>
          {/* Comment ça a été payé : moyen, fournisseur, carte (marque + 4
              derniers chiffres), statut et horodatage. Même composant que
              l'historique des courses. */}
          <div className="text-muted mt-1.5 flex justify-end">
            <PaymentLine
              withDate
              payment={{
                mode: isCash ? "cash" : receipt ? "card" : "online",
                provider: receipt?.provider ?? null,
                brand: receipt?.card_brand ?? null,
                last4: receipt?.card_last4 ?? null,
                wallet: receipt?.wallet ?? null,
                method: receipt?.method ?? null,
                status: receipt?.status ?? null,
                paid_at: receipt?.paid_at ?? null,
              }}
            />
          </div>
        </div>

        {/* ═══ BOUTIQUE ═══ */}
        <div className="border-border bg-surface mt-3 flex items-center gap-3 rounded-lg border px-4 py-3">
          {merchant.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                cldUrl(merchant.logo_url, {
                  width: 96,
                  height: 96,
                  crop: "fill",
                  gravity: "auto",
                }) ?? merchant.logo_url
              }
              alt=""
              loading="lazy"
              decoding="async"
              className="border-border size-10 shrink-0 rounded-xl border bg-white object-cover"
            />
          ) : (
            <div className="bg-foreground flex size-10 shrink-0 items-center justify-center rounded-xl text-base font-extrabold text-white">
              {merchant.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <b className="text-foreground block truncate text-sm font-bold">
              {merchant.name}
            </b>
            <small className="text-muted text-xs">
              <MapPin className="me-0.5 -mt-0.5 inline size-3" />
              {[merchant.address, merchant.commune]
                .filter(Boolean)
                .join(" · ") || "—"}
            </small>
          </div>
          <Link
            href={`/m/${merchant.slug}`}
            className="text-primary-600 text-body-sm shrink-0 font-bold hover:underline"
          >
            {t("see")} ›
          </Link>
        </div>

        {/* ═══ INFOS PRATIQUES (créneau / adresse + note) — secondaire ═══ */}
        {!isCancelled && (
          <div className="border-border bg-surface mt-3 rounded-lg border p-4">
            <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-semibold">
              {isDelivery ? (
                <MapPin className="size-3.5" />
              ) : (
                <Clock className="size-3.5" />
              )}
              {isDelivery ? t("deliveryAddress") : t("pickupSlot")}
            </div>
            <p className="text-foreground text-sm">
              {isDelivery
                ? ((order as { delivery_address_text: string | null })
                    .delivery_address_text ?? t("addressProvidedAtOrder"))
                : isSlot
                  ? formatSlotRange(
                      new Date(order.pickup_slot_start as string),
                      new Date(order.pickup_slot_end as string)
                    )
                  : formatAsapReady(new Date(order.pickup_slot_at))}
            </p>
            {order.customer_note && (
              <p className="text-muted border-border mt-2 border-t pt-2 text-xs">
                {t("note")} : {order.customer_note}
              </p>
            )}
          </div>
        )}

        {/* ═══ Notation du livreur (commande livrée + livreur assigné) ═══ */}
        {driverReview && (
          <div className="mt-3">
            <DriverReviewCard
              orderId={order.id}
              driverName={driverReview.name}
              initialRating={driverReview.rating}
            />
            <ReportDriver orderId={order.id} />
          </div>
        )}
      </div>
    </CustomerShell>
  );
}
