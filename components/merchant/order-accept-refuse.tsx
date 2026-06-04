"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";

/**
 * Boutons « Accepter / Refuser » directement sur une commande EN ATTENTE.
 * Le refus ouvre un choix de motif (rupture, surcharge…), tracé dans
 * order_events.note. Accepter = passe en préparation.
 */
const REFUSAL_REASONS = [
  "Article(s) en rupture",
  "Trop de commandes (surcharge)",
  "Commerce fermé / fin de service",
  "Adresse hors zone de livraison",
  "Client injoignable",
  "Autre raison",
];

export function OrderAcceptRefuse({
  orderId,
  size = "sm",
}: {
  orderId: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [refusing, setRefusing] = useState(false);

  const accept = () =>
    start(async () => {
      const res = await updateOrderStatus(orderId, "preparing");
      if (res.error) {
        toast.error(res.error);
        // Board périmé (commande déjà annulée/avancée) → on re-synchronise pour
        // faire disparaître la carte morte au lieu de la laisser cliquable.
        if (res.stale) router.refresh();
        return;
      }
      toast.success("Commande acceptée — en préparation");
      router.refresh();
    });

  const refuse = (reason: string) =>
    start(async () => {
      const res = await updateOrderStatus(
        orderId,
        "cancelled",
        undefined,
        reason
      );
      if (res.error) {
        toast.error(res.error);
        if (res.stale) {
          setRefusing(false);
          router.refresh();
        }
        return;
      }
      toast.success("Commande refusée");
      setRefusing(false);
      router.refresh();
    });

  const btn = size === "md" ? "px-3 py-2 text-sm" : "px-2.5 py-1.5 text-xs";

  if (refusing) {
    return (
      <div
        className="border-border bg-surface absolute right-0 z-20 mt-1 w-60 rounded-[12px] border p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-muted px-1 pb-1 text-[11px] font-semibold tracking-wide uppercase">
          Motif du refus
        </p>
        <ul className="space-y-0.5">
          {REFUSAL_REASONS.map((r) => (
            <li key={r}>
              <button
                type="button"
                onClick={() => refuse(r)}
                disabled={pending}
                className="hover:bg-danger-50 text-foreground flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-xs disabled:opacity-50"
              >
                {r}
                {pending && <Loader2 className="size-3.5 animate-spin" />}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setRefusing(false)}
          className="text-muted mt-1 w-full rounded-[8px] px-2 py-1 text-center text-[11px] hover:underline"
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className={cn(
          "bg-success-600 hover:bg-success-700 inline-flex items-center gap-1 rounded-[8px] font-semibold text-white disabled:opacity-50",
          btn
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        Accepter
      </button>
      <button
        type="button"
        onClick={() => setRefusing(true)}
        disabled={pending}
        className={cn(
          "border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[8px] border font-semibold disabled:opacity-50",
          btn
        )}
      >
        <X className="size-4" />
        Refuser
      </button>
    </div>
  );
}
