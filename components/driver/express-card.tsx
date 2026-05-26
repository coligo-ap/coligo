"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bolt, Loader2, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { pullNextExpress } from "@/app/(driver)/actions";
import { AvailabilityToggle } from "./availability-toggle";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";

type CurrentOrder = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  status: string;
  delivery_mode: "express" | "tour" | null;
};

export function ExpressCard({
  merchantDriverId,
  availStatus,
  currentOrder,
}: {
  merchantDriverId: string;
  availStatus: "offline" | "available" | "busy";
  currentOrder: CurrentOrder | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showValidate, setShowValidate] = useState(false);

  // Realtime : si on est dispo et qu'une nouvelle commande express arrive,
  // on tente de la puller (le serveur fait FIFO + skip locked, donc safe
  // même si plusieurs livreurs tentent en même temps).
  const onChange = useCallback(() => {
    if (availStatus !== "available") return;
    start(async () => {
      const r = await pullNextExpress(merchantDriverId);
      if (r.orderId) {
        toast.success("Commande attribuée !");
        router.refresh();
      }
    });
  }, [availStatus, merchantDriverId, router]);

  useEffect(() => {
    if (availStatus !== "available") return;
    const supabase = createClient();
    const channel = supabase
      .channel(`driver-express-${merchantDriverId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `delivery_mode=eq.express`,
        },
        onChange
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `delivery_mode=eq.express`,
        },
        onChange
      )
      .subscribe();

    // Tentative immédiate au montage (cas où une commande est déjà en file).
    onChange();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [availStatus, merchantDriverId, onChange]);

  return (
    <section className="border-border bg-surface space-y-3 rounded-[14px] border p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bolt className="text-warning-500 size-5" />
          <p className="text-sm font-semibold">Livraison Express</p>
        </div>
        <AvailabilityToggle
          merchantDriverId={merchantDriverId}
          status={availStatus}
        />
      </header>

      {currentOrder ? (
        <div className="border-primary-200 bg-primary-50 space-y-2 rounded-[12px] border p-3">
          <p className="text-primary-700 text-xs font-semibold tracking-wide uppercase">
            Commande en cours
          </p>
          <p className="text-sm font-semibold">
            {currentOrder.customer_name ?? "Client"} ·{" "}
            {currentOrder.total_da != null
              ? formatDA(currentOrder.total_da)
              : "—"}
          </p>
          <p className="text-xs tracking-wide uppercase">
            Paiement :{" "}
            <strong>
              {currentOrder.payment_method === "online" ? "En ligne" : "Cash"}
            </strong>
          </p>
          {currentOrder.delivery_address_text && (
            <p className="text-muted flex items-start gap-1.5 text-xs">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              {currentOrder.delivery_address_text}
            </p>
          )}
          {(currentOrder.delivery_phone ?? currentOrder.customer_phone) && (
            <a
              href={`tel:${currentOrder.delivery_phone ?? currentOrder.customer_phone}`}
              className="text-primary-700 flex items-center gap-1.5 text-xs underline"
            >
              <Phone className="size-3.5" />
              {currentOrder.delivery_phone ?? currentOrder.customer_phone}
            </a>
          )}
          {currentOrder.delivery_lat && currentOrder.delivery_lng && (
            <a
              href={`https://www.google.com/maps?q=${currentOrder.delivery_lat},${currentOrder.delivery_lng}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary-700 inline-block text-xs underline"
            >
              Ouvrir dans Google Maps
            </a>
          )}
          <Button
            type="button"
            className="w-full"
            onClick={() => setShowValidate(true)}
          >
            Marquer livré
          </Button>
        </div>
      ) : availStatus === "available" ? (
        <p className="text-muted flex items-center gap-2 text-xs">
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          En attente d&apos;une commande Express…
        </p>
      ) : (
        <p className="text-muted text-xs">
          Bascule sur « Disponible » pour recevoir des commandes Express.
        </p>
      )}

      {showValidate && currentOrder && (
        <DeliveryValidationDialog
          orderId={currentOrder.id}
          paymentMethod={currentOrder.payment_method}
          onClose={() => setShowValidate(false)}
          onSuccess={() => {
            setShowValidate(false);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
