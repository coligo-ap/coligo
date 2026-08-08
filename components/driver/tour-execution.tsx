"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Banknote,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Package,
  Phone,
  Route,
  StickyNote,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import {
  confirmArrival,
  noteCallAttempt,
  markTourPickedUp,
  reorderTourFromPosition,
} from "@/app/(driver)/actions";
import { getPosition } from "@/lib/native/geolocation";
import {
  BRAND_GO,
  BRAND_VIOLET,
  PartnerBadge,
  PartnerProgress,
  SORA,
} from "@/components/shared/partner-ui";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { DeliveryRouteMap } from "./delivery-route-map";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";
import { OrderChat } from "@/components/chat/order-chat";

type Stop = {
  stop_id: string;
  stop_order: number;
  stop_status: "pending" | "delivered" | "failed";
  order_id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_note: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
};

/**
 * Exécution de tournée — refonte style maquette livreur (tokens partagés
 * `--d-*`, Sora, cartes d'arrêt numérotées, jauge de progression, récap
 * financier en carte dégradé violet). La LOGIQUE MÉTIER est inchangée :
 * mêmes formules que le ledger (mig 0042), mêmes actions serveur, validation
 * anti-fraude intacte. Feedback d'action INLINE (règle produit, plus de toast).
 */
export function TourExecution({
  stops,
  tourId,
}: {
  stops: Stop[];
  tourId: string;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [validateFor, setValidateFor] = useState<Stop | null>(null);
  const [pending, start] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(
    stops.find((s) => s.stop_status === "pending")?.stop_id ?? null
  );
  // Feedback INLINE de la barre d'action (pickup groupé / ré-optimisation).
  const [actionMsg, setActionMsg] = useState<{
    tone: "ok" | "ko";
    text: string;
  } | null>(null);
  // Erreur inline par arrêt (« je suis arrivé »).
  const [stopErr, setStopErr] = useState<Record<string, string>>({});

  const allPickedUp = stops.every(
    (s) => s.stop_status !== "pending" || s.delivery_picked_up_at != null
  );

  // Stop en cours = premier arrêt non livré déjà récupéré → on diffuse la
  // position du livreur au client de cette commande.
  const currentStop = stops.find(
    (s) => s.stop_status === "pending" && s.delivery_picked_up_at != null
  );

  const deliveredCount = stops.filter(
    (s) => s.stop_status === "delivered"
  ).length;

  // Récap financier de la tournée (mêmes formules que le ledger, cf. mig 0042) :
  //  - gains livreur = somme des delivery_fee_da (toutes commandes)
  //  - dû au commerçant = somme, UNIQUEMENT sur les commandes CASH, de
  //    max(total_da - delivery_fee_da, 0). Les commandes payées EN LIGNE sont
  //    déjà réglées → exclues du dû.
  const earnings = stops.reduce((s, x) => s + (x.delivery_fee_da ?? 0), 0);
  const cashStops = stops.filter((x) => x.payment_method === "cash");
  const owedMerchant = cashStops.reduce(
    (s, x) => s + Math.max(0, (x.total_da ?? 0) - (x.delivery_fee_da ?? 0)),
    0
  );
  const cashToCollect = cashStops.reduce((s, x) => s + (x.total_da ?? 0), 0);

  const onBulkPickup = () =>
    start(async () => {
      setActionMsg(null);
      const r = await markTourPickedUp(tourId);
      if (!r.ok) {
        setActionMsg({ tone: "ko", text: r.error ?? tr("Erreur", "خطأ") });
        return;
      }
      setActionMsg({
        tone: "ok",
        text: isAr
          ? `تم استلام ${r.count} طلب — جولة موفّقة!`
          : `${r.count} commande${(r.count ?? 0) > 1 ? "s" : ""} récupérée${
              (r.count ?? 0) > 1 ? "s" : ""
            } — bonne tournée !`,
      });
      router.refresh();
    });

  // Arrivée GÉO-CLÔTURÉE (mig 0329) : à quelques mètres de l'adresse exacte du
  // client pour démarrer le minuteur d'attente (anti-fraude no-show).
  const onArrived = (stopId: string, orderId: string) =>
    start(async () => {
      setStopErr((e) => ({ ...e, [stopId]: "" }));
      let pos: { latitude: number; longitude: number };
      try {
        pos = await getPosition();
      } catch {
        setStopErr((e) => ({
          ...e,
          [stopId]: tr(
            "Active la localisation pour confirmer ton arrivée.",
            "فعّل تحديد الموقع لتأكيد وصولك."
          ),
        }));
        return;
      }
      const r = await confirmArrival({
        orderId,
        lat: pos.latitude,
        lng: pos.longitude,
      });
      if (!r.ok) {
        setStopErr((e) => ({
          ...e,
          [stopId]:
            r.reason === "too_far"
              ? tr(
                  "Trop loin de l'adresse du client — rapproche-toi.",
                  "بعيد عن عنوان الزبون — اقترب."
                )
              : r.reason === "no_location"
                ? tr(
                    "Adresse sans position GPS — contacte le support.",
                    "عنوان بدون موقع — تواصل مع الدعم."
                  )
                : (r.reason ?? tr("Erreur", "خطأ")),
        }));
        return;
      }
      router.refresh();
    });

  const onReorder = () =>
    start(async () => {
      setActionMsg(null);
      try {
        const pos = await getPosition();
        const r = await reorderTourFromPosition(
          tourId,
          pos.latitude,
          pos.longitude
        );
        if (!r.ok) {
          setActionMsg({ tone: "ko", text: r.error ?? tr("Erreur", "خطأ") });
          return;
        }
        setActionMsg({
          tone: "ok",
          text: isAr
            ? `أُعيد ترتيب المسار (${r.reordered ?? 0} محطات)`
            : `Itinéraire ré-optimisé (${r.reordered ?? 0} arrêts)`,
        });
        router.refresh();
      } catch (err) {
        setActionMsg({
          tone: "ko",
          text:
            err instanceof Error
              ? err.message
              : tr(
                  "Position GPS indisponible pour ré-optimiser",
                  "موقع GPS غير متاح لإعادة الترتيب"
                ),
        });
      }
    });

  return (
    <div className="space-y-4">
      {currentStop && (
        <DriverLocationBroadcaster orderId={currentStop.order_id} />
      )}

      {/* Récap financier — carte dégradé violet (style net-card maquette). */}
      <div
        className="rounded-sheet-xl p-5 text-white"
        style={{
          background: `linear-gradient(135deg, ${BRAND_VIOLET}, #4b1fa6)`,
          boxShadow: "0 18px 40px -14px rgba(108,43,217,.45)",
        }}
      >
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label font-semibold opacity-85">
              {tr("Tes gains · tournée", "أرباحك · الجولة")}
            </p>
            <p
              className="mt-1 text-[30px] leading-none font-extrabold tracking-[-1px]"
              style={{ fontFamily: SORA }}
            >
              {formatDA(earnings)}
            </p>
          </div>
          <div className="text-right rtl:text-left">
            <p className="text-micro-lg font-semibold tracking-[0.4px] uppercase opacity-85">
              {tr("À reverser au commerçant", "للتسديد للتاجر")}
            </p>
            <p
              className="text-heading-sm mt-1 font-extrabold"
              style={{ fontFamily: SORA }}
            >
              {formatDA(owedMerchant)}
            </p>
          </div>
        </div>
        <div className="rounded-card-lg text-caption-lg mt-3.5 flex items-center gap-2 bg-white/14 px-3 py-2.5 font-medium">
          <Banknote className="size-4 shrink-0" />
          {tr("Cash à encaisser :", "نقد للتحصيل:")}{" "}
          <b style={{ fontFamily: SORA }}>{formatDA(cashToCollect)}</b>
          <span className="ms-auto opacity-80">
            {tr("en ligne = déjà payé", "عبر الإنترنت = مدفوع")}
          </span>
        </div>
      </div>

      {/* Progression de la tournée */}
      <div className="rounded-sheet-lg border border-[var(--d-line)] bg-[var(--d-surface)] p-4">
        <div className="text-label-lg mb-2 flex items-center justify-between font-bold">
          <span className="text-[var(--d-ink)]">
            {tr("Progression", "التقدّم")}
          </span>
          <span className="tabular-nums" style={{ color: BRAND_VIOLET }}>
            {deliveredCount}/{stops.length} {tr("livrés", "مُسلَّمة")}
          </span>
        </div>
        <PartnerProgress
          value={deliveredCount}
          max={stops.length}
          tone={deliveredCount === stops.length ? BRAND_GO : BRAND_VIOLET}
        />
      </div>

      {/* Barre d'action : chargement groupé puis ré-optimisation. */}
      <div className="space-y-2">
        {!allPickedUp ? (
          <button
            type="button"
            onClick={onBulkPickup}
            disabled={pending}
            className="text-title-sm flex h-[54px] w-full items-center justify-center gap-2 rounded-lg font-bold text-white active:scale-[0.99] disabled:opacity-60"
            style={{
              fontFamily: SORA,
              background: BRAND_VIOLET,
              boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
            }}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Package className="size-4" />
            )}
            {tr("J'ai chargé toutes les commandes", "حمّلت كل الطلبات")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReorder}
            disabled={pending}
            className="text-body-lg flex h-[50px] w-full items-center justify-center gap-2 rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)] font-bold text-[var(--d-ink)] active:scale-[0.99] disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Route className="size-4" style={{ color: BRAND_VIOLET }} />
            )}
            {tr("Re-optimiser depuis ma position", "إعادة الترتيب من موقعي")}
          </button>
        )}
        {actionMsg && (
          <p
            className="text-label rounded-md px-3 py-2 text-center font-bold"
            style={
              actionMsg.tone === "ok"
                ? { background: "rgba(22,179,100,.12)", color: BRAND_GO }
                : { background: "rgba(229,72,77,.1)", color: "#e5484d" }
            }
          >
            {actionMsg.text}
          </p>
        )}
      </div>

      {/* Arrêts (cartes numérotées, dépliables) */}
      <ol className="space-y-3">
        {stops.map((s) => {
          const done = s.stop_status === "delivered";
          const expanded = expandedId === s.stop_id;
          return (
            <li
              key={s.stop_id}
              className={
                "rounded-sheet-lg space-y-2 border border-[var(--d-line)] bg-[var(--d-surface)] p-4 " +
                (done ? "opacity-60" : "")
              }
            >
              <header
                className="flex cursor-pointer items-center justify-between gap-2"
                onClick={() => setExpandedId(expanded ? null : s.stop_id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="text-body-sm grid size-9 shrink-0 place-items-center rounded-full font-extrabold tabular-nums"
                    style={
                      done
                        ? {
                            background: "rgba(22,179,100,.12)",
                            color: BRAND_GO,
                          }
                        : {
                            background: "rgba(108,43,217,.1)",
                            color: BRAND_VIOLET,
                            fontFamily: SORA,
                          }
                    }
                  >
                    {done ? <Check className="size-4" /> : s.stop_order}
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-xl truncate font-bold text-[var(--d-ink)]">
                      {s.customer_name ?? tr("Client", "زبون")}
                    </p>
                    <p className="text-label font-medium text-[var(--d-muted)]">
                      {s.payment_method === "online"
                        ? tr("Payé en ligne", "مدفوع عبر الإنترنت")
                        : tr("Espèces", "نقداً")}{" "}
                      · {s.total_da != null ? formatDA(s.total_da) : "—"}
                    </p>
                  </div>
                </div>
                {done ? (
                  <PartnerBadge tone="ok">
                    {tr("Livré", "مُسلَّم")}
                  </PartnerBadge>
                ) : (
                  <ChevronDown
                    className="size-5 shrink-0 text-[var(--d-muted)] transition-transform"
                    style={{ transform: expanded ? "rotate(180deg)" : "none" }}
                  />
                )}
              </header>

              {expanded && !done && (
                <div className="space-y-2.5 pt-1">
                  {s.delivery_address_text && (
                    <p className="text-label-lg flex items-start gap-1.5 font-medium text-[var(--d-muted)]">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" />
                      {s.delivery_address_text}
                    </p>
                  )}
                  {(s.delivery_phone ?? s.customer_phone) && (
                    <a
                      href={`tel:${s.delivery_phone ?? s.customer_phone}`}
                      onClick={() => void noteCallAttempt(s.order_id)}
                      className="text-label-lg inline-flex items-center gap-1.5 font-bold"
                      style={{ color: BRAND_VIOLET }}
                    >
                      <Phone className="size-3.5" />
                      {s.delivery_phone ?? s.customer_phone}
                    </a>
                  )}
                  {s.delivery_note && (
                    <p
                      className="text-label flex items-start gap-1.5 rounded-md px-3 py-2 font-medium"
                      style={{
                        background: "rgba(245,158,11,.12)",
                        color: "#c2790a",
                      }}
                    >
                      <StickyNote className="mt-0.5 size-3.5 shrink-0" />
                      {s.delivery_note}
                    </p>
                  )}

                  {s.delivery_lat != null && s.delivery_lng != null && (
                    <DeliveryRouteMap
                      target={{ lat: s.delivery_lat, lng: s.delivery_lng }}
                      label={tr(
                        "Vers le client (livraison)",
                        "نحو الزبون (التسليم)"
                      )}
                      height={180}
                    />
                  )}

                  {/* Chat avec le client une fois la commande récupérée. */}
                  {s.delivery_picked_up_at != null && (
                    <OrderChat
                      orderId={s.order_id}
                      role="courier"
                      phone={s.delivery_phone ?? s.customer_phone}
                      phoneLabel={
                        isAr
                          ? `الاتصال بـ ${s.customer_name ?? "الزبون"}`
                          : `Appeler ${s.customer_name ?? "le client"}`
                      }
                    />
                  )}

                  {/* Étape : signaler l'arrivée (visible côté client) puis valider. */}
                  {s.delivery_picked_up_at != null &&
                    s.delivery_arrived_at == null && (
                      <button
                        type="button"
                        onClick={() => onArrived(s.stop_id, s.order_id)}
                        disabled={pending}
                        className="text-body-lg flex h-[50px] w-full items-center justify-center gap-2 rounded-lg border border-[var(--d-line)] bg-[var(--d-soft)] font-bold text-[var(--d-ink)] active:scale-[0.99] disabled:opacity-60"
                      >
                        {pending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <MapPin
                            className="size-4"
                            style={{ color: BRAND_VIOLET }}
                          />
                        )}
                        {tr("Je suis arrivé chez le client", "وصلت إلى الزبون")}
                      </button>
                    )}
                  {stopErr[s.stop_id] ? (
                    <p
                      className="text-label rounded-md px-3 py-2 text-center font-bold"
                      style={{
                        background: "rgba(229,72,77,.1)",
                        color: "#e5484d",
                      }}
                    >
                      {stopErr[s.stop_id]}
                    </p>
                  ) : null}

                  {(s.delivery_arrived_at != null ||
                    s.delivery_picked_up_at == null) && (
                    <button
                      type="button"
                      onClick={() => setValidateFor(s)}
                      className="text-title-sm flex h-[54px] w-full items-center justify-center gap-2 rounded-lg font-bold text-white active:scale-[0.99]"
                      style={{
                        fontFamily: SORA,
                        background: BRAND_VIOLET,
                        boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
                      }}
                    >
                      <Check className="size-4" />
                      {tr("Marquer livré", "وسم كمُسلَّم")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {validateFor && (
        <DeliveryValidationDialog
          orderId={validateFor.order_id}
          orderNumber={validateFor.order_number}
          paymentMethod={validateFor.payment_method}
          customerName={validateFor.customer_name}
          totalDa={validateFor.total_da}
          arrivedAt={validateFor.delivery_arrived_at}
          onClose={() => setValidateFor(null)}
          onSuccess={() => {
            const nextPending = stops.find(
              (x) =>
                x.stop_id !== validateFor.stop_id && x.stop_status === "pending"
            );
            setValidateFor(null);
            if (nextPending) setExpandedId(nextPending.stop_id);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
