"use client";

import { useRef, useState, useTransition } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsRight, Loader2, PackageCheck } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { confirmDeliveryReception } from "@/app/(customer)/commandes/actions";

/**
 * Glisser pour confirmer la BONNE RÉCEPTION de la commande, côté CLIENT.
 *
 * Parcours : le client glisse le curseur jusqu'au bout → une fenêtre de DOUBLE
 * CONFIRMATION s'ouvre (« avez-vous bien tout reçu ? ») → à la confirmation, la
 * livraison est validée au livreur (RPC `customer_confirm_delivery`, conditions
 * anti-fraude côté SQL : livreur arrivé, commande active). Très utile si le
 * téléphone du livreur est déchargé : il fait valider directement par le client.
 * Vaut aussi pour les commandes prépayées (cashback / Coligo Pay / Chargily).
 */

export type ReceptionLabels = {
  slide: string;
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  success: string;
  rtl?: boolean;
};

const THUMB = 52;

export function ConfirmReception({
  orderId,
  labels,
}: {
  orderId: string;
  labels: ReceptionLabels;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number } | null>(null);

  const maxX = () =>
    Math.max(0, (trackRef.current?.offsetWidth ?? 280) - THUMB - 8);

  const onDown = (e: ReactPointerEvent) => {
    drag.current = { startX: e.clientX - x };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const nx = Math.min(maxX(), Math.max(0, e.clientX - drag.current.startX));
    setX(nx);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    const reached = x >= maxX() - 4;
    setX(0);
    if (reached) setArmed(true);
  };

  const doConfirm = () =>
    start(async () => {
      const r = await confirmDeliveryReception(orderId);
      if (r.ok) {
        toast.success(labels.success);
        setArmed(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Erreur");
        setArmed(false);
      }
    });

  const progress = maxX() > 0 ? x / maxX() : 0;

  return (
    <div className="border-success-200 bg-success-50 mt-3 rounded-[18px] border p-3.5">
      <p className="text-success-800 mb-2.5 flex items-center gap-1.5 text-[13px] font-extrabold">
        <PackageCheck className="size-4" />
        {labels.title}
      </p>

      {/* Piste de glissement */}
      <div
        ref={trackRef}
        className="relative h-[60px] w-full overflow-hidden rounded-[14px] bg-white shadow-inner select-none"
      >
        <span
          className="text-success-700/70 pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-bold"
          style={{ opacity: 1 - progress * 1.4 }}
        >
          {labels.slide}
        </span>
        <button
          type="button"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={labels.slide}
          className="bg-success-600 absolute top-1 bottom-1 left-1 grid place-items-center rounded-[11px] text-white"
          style={{
            width: THUMB,
            transform: `translateX(${x}px)`,
            transition: dragging ? "none" : "transform .2s ease",
            touchAction: "none",
          }}
        >
          <ChevronsRight className="size-6" />
        </button>
      </div>

      {/* Double confirmation */}
      {armed && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
          <div className="w-full max-w-sm rounded-[20px] bg-white p-5 shadow-2xl">
            <div className="bg-success-100 text-success-700 mx-auto grid size-14 place-items-center rounded-full">
              <PackageCheck className="size-7" />
            </div>
            <h3 className="text-foreground mt-3 text-center text-[17px] font-black">
              {labels.title}
            </h3>
            <p className="text-muted mt-1.5 text-center text-[13px] font-medium">
              {labels.body}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={doConfirm}
                disabled={pending}
                className="bg-success-600 hover:bg-success-700 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Check className="size-5" />
                )}
                {labels.confirm}
              </button>
              <button
                type="button"
                onClick={() => setArmed(false)}
                disabled={pending}
                className="text-muted h-11 w-full text-[14px] font-semibold disabled:opacity-50"
              >
                {labels.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
