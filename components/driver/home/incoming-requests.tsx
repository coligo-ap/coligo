"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ChevronDown, MapPin, Package, Phone, Truck, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { haversineKm } from "@/lib/delivery/distance";
import {
  computeDriverNet,
  DEFAULT_DRIVER_FEE_CONFIG,
  type DriverFeeConfig,
} from "@/lib/driver/settlement";
import { declineExpress } from "@/app/(driver)/actions";
import { useDriverOnline } from "@/lib/driver/online-store";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { toast } from "@/components/ui/toast";

/**
 * DEMANDES DE COURSE sur l'ACCUEIL (façon UberEats) — liste dépliable.
 *
 * Toute nouvelle course EXPRESS attribuée (pull géographique, mig 0323) et toute
 * TOURNÉE en attente apparaissent INSTANTANÉMENT ici, en cartes accordéon
 * (ouvrante/fermante). Chaque carte : en-tête toujours visible (commerçant,
 * distance, gain net, badge paiement) + corps déplié (trajet, articles, appel
 * client, Accepter / Refuser pour l'express ; Voir la tournée pour la tournée).
 *
 * L'express est attribué côté serveur → « Accepter » ouvre la course éprouvée
 * (/driver/course/[id]) ; « Refuser » libère la commande (cooldown 10 min).
 * Realtime (canal orders filtré sur ce livreur) + repli polling + resync à la
 * reprise au premier plan → la carte suit l'état serveur sans rafraîchir la page.
 */

type ExpressReq = {
  id: string;
  order_number: string | null;
  delivery_fee_da: number | null;
  total_da: number | null;
  payment_method: "cash" | "online";
  payment_status: string | null;
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_phone: string | null;
  customer_phone: string | null;
  status: string;
  merchant_name: string;
  merchant_lat: number | null;
  merchant_lng: number | null;
  items: number;
};

export type TourReq = {
  mdId: string;
  name: string;
  commune: string | null;
  pending: number;
};

const KM_TO_MIN = 5;
const fmtKm = (km: number | null) =>
  km == null ? "—" : km.toFixed(1).replace(".", ",");

export function IncomingRequests({
  driverId,
  tours,
  driverFeeConfig = DEFAULT_DRIVER_FEE_CONFIG,
}: {
  driverId: string;
  tours: TourReq[];
  driverFeeConfig?: DriverFeeConfig;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const online = useDriverOnline();
  const router = useRouter();
  const coords = useDriverPosition();

  const [express, setExpress] = useState<ExpressReq[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Charge les courses express EN ATTENTE (attribuées, pas encore récupérées).
  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, delivery_fee_da, total_da, payment_method, payment_status, delivery_address_text, delivery_lat, delivery_lng, delivery_phone, customer_phone, status, delivery_mode, delivery_picked_up_at, delivery_driver_id, order_items(id), merchants(name, latitude, longitude)"
      )
      .eq("delivery_driver_id", driverId)
      .eq("delivery_mode", "express")
      .is("delivery_picked_up_at", null)
      .in("status", ["preparing", "ready"])
      .order("created_at", { ascending: true });

    type Row = {
      id: string;
      order_number: string | null;
      delivery_fee_da: number | null;
      total_da: number | null;
      payment_method: "cash" | "online";
      payment_status: string | null;
      delivery_address_text: string | null;
      delivery_lat: number | null;
      delivery_lng: number | null;
      delivery_phone: string | null;
      customer_phone: string | null;
      status: string;
      order_items: { id: string }[] | null;
      merchants:
        | { name: string; latitude: number | null; longitude: number | null }
        | { name: string; latitude: number | null; longitude: number | null }[]
        | null;
    };
    const rows = (data ?? []) as Row[];
    const mapped: ExpressReq[] = rows.map((o) => {
      const m = Array.isArray(o.merchants) ? o.merchants[0] : o.merchants;
      return {
        id: o.id,
        order_number: o.order_number,
        delivery_fee_da: o.delivery_fee_da,
        total_da: o.total_da,
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        delivery_address_text: o.delivery_address_text,
        delivery_lat: o.delivery_lat,
        delivery_lng: o.delivery_lng,
        delivery_phone: o.delivery_phone,
        customer_phone: o.customer_phone,
        status: o.status,
        merchant_name: m?.name ?? tr("Commerçant", "التاجر"),
        merchant_lat: m?.latitude ?? null,
        merchant_lng: m?.longitude ?? null,
        items: o.order_items?.length ?? 0,
      };
    });
    setExpress(mapped);
    // Ouvre automatiquement la nouvelle course reçue.
    setOpenId((cur) => cur ?? mapped[0]?.id ?? null);
  }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chargement initial + realtime (orders de CE livreur) + repli polling.
  useEffect(() => {
    void load();
    const supabase = createClient();
    const channel = supabase
      .channel(`courier-incoming:${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `delivery_driver_id=eq.${driverId}`,
        },
        () => void load()
      )
      .subscribe();
    const poll = setInterval(() => void load(), 15_000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [driverId, load]);

  // Reprise au premier plan (WebSocket a pu tomber en arrière-plan).
  useResumeResync(() => void load());

  const me = useMemo(
    () => (coords ? { lat: coords.latitude, lng: coords.longitude } : null),
    [coords]
  );

  const cards = useMemo(() => {
    const ex = express.map((o) => {
      const pickup =
        o.merchant_lat != null && o.merchant_lng != null
          ? { lat: o.merchant_lat, lng: o.merchant_lng }
          : null;
      const drop =
        o.delivery_lat != null && o.delivery_lng != null
          ? { lat: o.delivery_lat, lng: o.delivery_lng }
          : null;
      const legPickup = me && pickup ? haversineKm(me, pickup) : null;
      const legDrop = pickup && drop ? haversineKm(pickup, drop) : null;
      const km =
        legPickup != null || legDrop != null
          ? (legPickup ?? 0) + (legDrop ?? 0)
          : null;
      return {
        kind: "express" as const,
        id: o.id,
        order: o,
        km,
        min: km != null ? Math.max(1, Math.round(km * KM_TO_MIN)) : null,
        net: computeDriverNet(o.delivery_fee_da ?? 0, driverFeeConfig),
      };
    });
    const tr_ = tours
      .filter((t) => t.pending > 0)
      .map((t) => ({ kind: "tour" as const, id: `tour-${t.mdId}`, tour: t }));
    return [...ex, ...tr_];
  }, [express, tours, me, driverFeeConfig]);

  if (!online && cards.length === 0) return null;
  if (cards.length === 0) return null;

  const accept = (id: string) => router.push(`/driver/course/${id}`);
  const refuse = (id: string) => {
    setBusyId(id);
    void (async () => {
      try {
        const r = await declineExpress(id);
        if (!r.ok) {
          toast.error(tr("Impossible de refuser.", "تعذّر الرفض."));
          return;
        }
        setExpress((prev) => prev.filter((o) => o.id !== id));
        toast.success(tr("Course refusée.", "تم رفض التوصيلة."));
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <div
      className="fixed inset-x-0 z-[70] mx-auto max-w-md px-3"
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
    >
      <div className="flex flex-col gap-2">
        {cards.map((card) => {
          const isOpen = openId === card.id;
          const toggle = () => setOpenId(isOpen ? null : card.id);

          if (card.kind === "tour") {
            const t = card.tour;
            return (
              <div
                key={card.id}
                className="overflow-hidden rounded-[16px] border shadow-lg"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--surface)",
                }}
              >
                <button
                  type="button"
                  onClick={toggle}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-[11px]"
                    style={{ background: "rgba(22,179,100,.14)" }}
                  >
                    <Truck
                      className="size-[18px]"
                      style={{ color: "#16b364" }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b
                      className="block truncate text-[14px] font-extrabold"
                      style={{ color: "var(--ink)" }}
                    >
                      {t.name}
                    </b>
                    <small
                      className="block text-[11.5px] font-semibold"
                      style={{ color: "var(--muted)" }}
                    >
                      {t.pending}{" "}
                      {t.pending > 1
                        ? tr("livraisons en tournée", "توصيلات في الجولة")
                        : tr("livraison en tournée", "توصيلة في الجولة")}
                      {t.commune ? ` · ${t.commune}` : ""}
                    </small>
                  </span>
                  <ChevronDown
                    className="size-5 shrink-0 transition-transform"
                    style={{
                      color: "var(--muted)",
                      transform: isOpen ? "rotate(180deg)" : undefined,
                    }}
                  />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    <button
                      type="button"
                      onClick={() => router.push("/driver/tournees")}
                      className="w-full rounded-[12px] py-2.5 text-[13.5px] font-bold text-white"
                      style={{ background: "#16b364" }}
                    >
                      {tr("Voir la tournée", "عرض الجولة")}
                    </button>
                  </div>
                )}
              </div>
            );
          }

          const o = card.order;
          const phone = o.delivery_phone ?? o.customer_phone;
          const prepaid = o.payment_method === "online";
          return (
            <div
              key={card.id}
              className="overflow-hidden rounded-[16px] border shadow-lg"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
              }}
            >
              <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-[11px]"
                  style={{ background: "rgba(108,43,217,.14)" }}
                >
                  <Zap
                    className="size-[18px]"
                    style={{ color: "var(--violet)" }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <b
                    className="block truncate text-[14px] font-extrabold"
                    style={{ color: "var(--ink)" }}
                  >
                    {o.merchant_name}
                  </b>
                  <small
                    className="block text-[11.5px] font-semibold"
                    style={{ color: "var(--muted)" }}
                  >
                    {card.min != null
                      ? `${card.min} min · ${fmtKm(card.km)} km`
                      : tr("Course express", "توصيلة سريعة")}
                  </small>
                </span>
                <span className="shrink-0 text-end">
                  <b
                    className="block text-[15px] leading-none font-black"
                    style={{ color: "var(--violet)" }}
                  >
                    {card.net} DA
                  </b>
                  <small
                    className="mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9.5px] font-bold"
                    style={{
                      background: prepaid
                        ? "rgba(22,179,100,.14)"
                        : "rgba(245,158,11,.16)",
                      color: prepaid ? "#0f9d58" : "#c2790a",
                    }}
                  >
                    {prepaid
                      ? tr("En ligne", "عبر الإنترنت")
                      : tr("Espèces", "نقداً")}
                  </small>
                </span>
                <ChevronDown
                  className="size-5 shrink-0 transition-transform"
                  style={{
                    color: "var(--muted)",
                    transform: isOpen ? "rotate(180deg)" : undefined,
                  }}
                />
              </button>

              {isOpen && (
                <div className="px-3 pb-3">
                  {/* Trajet : retrait → livraison */}
                  <div
                    className="mb-2.5 rounded-[12px] px-3 py-2.5"
                    style={{ background: "var(--soft)" }}
                  >
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="mt-0.5 size-3.5 shrink-0"
                        style={{ color: "var(--violet)" }}
                      />
                      <span
                        className="text-[12.5px] font-medium"
                        style={{ color: "var(--ink)" }}
                      >
                        {o.delivery_address_text ??
                          tr("Adresse client", "عنوان الزبون")}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 flex items-center gap-3 text-[11.5px] font-semibold"
                      style={{ color: "var(--muted)" }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Package className="size-3.5" />
                        {o.items}{" "}
                        {o.items > 1
                          ? tr("articles", "منتجات")
                          : tr("article", "منتج")}
                      </span>
                      <span>
                        {prepaid
                          ? tr("Déjà payé", "مدفوع مسبقاً")
                          : `${o.total_da ?? 0} DA ${tr("à encaisser", "للتحصيل")}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {phone && (
                      <a
                        href={`tel:${phone}`}
                        className="grid size-11 shrink-0 place-items-center rounded-[12px] border"
                        style={{
                          borderColor: "var(--line)",
                          color: "var(--violet)",
                        }}
                        aria-label={tr("Appeler le client", "الاتصال بالزبون")}
                      >
                        <Phone className="size-5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => refuse(o.id)}
                      disabled={busyId === o.id}
                      className="h-11 flex-1 rounded-[12px] border text-[13.5px] font-bold disabled:opacity-50"
                      style={{
                        borderColor: "var(--line)",
                        color: "var(--red)",
                      }}
                    >
                      {tr("Refuser", "رفض")}
                    </button>
                    <button
                      type="button"
                      onClick={() => accept(o.id)}
                      className="h-11 flex-[1.6] rounded-[12px] text-[13.5px] font-bold text-white"
                      style={{ background: "var(--violet)" }}
                    >
                      {tr("Accepter", "قبول")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
