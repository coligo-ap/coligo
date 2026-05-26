"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDA } from "@/lib/utils";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";

type Stop = {
  stop_id: string;
  stop_order: number;
  stop_status: "pending" | "delivered" | "failed";
  order_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

export function TourExecution({ stops }: { stops: Stop[] }) {
  const router = useRouter();
  const [validateFor, setValidateFor] = useState<Stop | null>(null);

  return (
    <ol className="space-y-3">
      {stops.map((s) => {
        const done = s.stop_status === "delivered";
        return (
          <li
            key={s.stop_id}
            className={
              "border-border bg-surface space-y-2 rounded-[14px] border p-4 " +
              (done ? "opacity-70" : "")
            }
          >
            <header className="flex items-center justify-between gap-2">
              <span className="bg-primary-100 text-primary-700 inline-flex size-7 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                {s.stop_order}
              </span>
              {done && (
                <span className="text-success-700 inline-flex items-center gap-1 text-xs font-semibold">
                  <Check className="size-3.5" /> Livré
                </span>
              )}
            </header>
            <div>
              <p className="text-sm font-semibold">
                {s.customer_name ?? "Client"} ·{" "}
                {s.total_da != null ? formatDA(s.total_da) : "—"}
              </p>
              <p className="text-muted text-xs tracking-wide uppercase">
                {s.payment_method === "online" ? "Payé en ligne" : "Cash"}
              </p>
            </div>
            {s.delivery_address_text && (
              <p className="text-muted flex items-start gap-1.5 text-xs">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                {s.delivery_address_text}
              </p>
            )}
            {(s.delivery_phone ?? s.customer_phone) && (
              <a
                href={`tel:${s.delivery_phone ?? s.customer_phone}`}
                className="text-primary-700 flex items-center gap-1.5 text-xs underline"
              >
                <Phone className="size-3.5" />
                {s.delivery_phone ?? s.customer_phone}
              </a>
            )}
            {s.delivery_lat && s.delivery_lng && (
              <a
                href={`https://www.google.com/maps?q=${s.delivery_lat},${s.delivery_lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary-700 inline-block text-xs underline"
              >
                Ouvrir dans Google Maps
              </a>
            )}
            {!done && (
              <Button
                type="button"
                className="w-full"
                onClick={() => setValidateFor(s)}
              >
                Marquer livré
              </Button>
            )}
          </li>
        );
      })}

      {validateFor && (
        <DeliveryValidationDialog
          orderId={validateFor.order_id}
          paymentMethod={validateFor.payment_method}
          onClose={() => setValidateFor(null)}
          onSuccess={() => {
            setValidateFor(null);
            router.refresh();
          }}
        />
      )}
    </ol>
  );
}
