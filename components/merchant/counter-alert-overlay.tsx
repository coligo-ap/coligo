"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PartyPopper, Printer, X } from "lucide-react";
import { formatDA } from "@/lib/utils";

export type CounterAlertOrder = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
};

type Props = {
  order: CounterAlertOrder | null;
  onDismiss: () => void;
  onPrint?: (orderId: string) => void;
  canPrint?: boolean;
};

/**
 * Bandeau plein écran « Nouvelle commande ! » pour le mode comptoir.
 *
 * Conçu pour être impossible à rater : pleine largeur sur mobile, animation
 * d'apparition, fond violet de marque, gros boutons CTA. Le commerçant doit
 * explicitement cliquer pour fermer (pas d'auto-dismiss — c'est le but).
 */
export function CounterAlertOverlay({
  order,
  onDismiss,
  onPrint,
  canPrint = false,
}: Props) {
  // Bloque le scroll body tant que l'overlay est ouvert.
  useEffect(() => {
    if (!order) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [order]);

  if (!order) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Nouvelle commande reçue"
      className="bg-primary-700/95 fixed inset-0 z-[90] flex flex-col items-center justify-center px-6 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer l'alerte"
        className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="size-5" />
      </button>

      <div className="animate-pulse">
        <PartyPopper className="text-warning-300 mx-auto size-16" />
      </div>

      <h2 className="mt-6 text-center text-2xl font-bold text-white sm:text-3xl">
        Nouvelle commande !
      </h2>

      <p className="mt-2 text-center text-base text-white/90">
        {order.customer_name ?? "Client"}
        {order.total_da != null && (
          <>
            <span className="px-2 text-white/60">·</span>
            <span className="font-semibold">{formatDA(order.total_da)}</span>
          </>
        )}
      </p>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-2.5">
        <Link
          href={`/orders/${order.id}`}
          onClick={onDismiss}
          className="text-primary-700 inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-white px-5 text-base font-semibold shadow-lg hover:bg-white/90"
        >
          Voir la commande
        </Link>
        {canPrint && onPrint && (
          <button
            type="button"
            onClick={() => onPrint(order.id)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-white/30 px-5 text-sm font-medium text-white hover:bg-white/10"
          >
            <Printer className="size-4" />
            Imprimer le ticket
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-1 inline-flex h-10 w-full items-center justify-center rounded-[12px] text-sm font-medium text-white/80 hover:text-white"
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}
