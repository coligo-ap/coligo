"use client";

import { LifeBuoy } from "lucide-react";
import {
  openSupportChat,
  type SupportAttributes,
} from "@/components/support/tawk-chat";

/**
 * Bouton « Contacter le support » rattaché à UNE commande : ouvre le live chat
 * Tawk.to (lanceur flottant masqué) en injectant la référence de la commande
 * (+ tout contexte utile : statut, boutique, montant) pour que l'agent sache de
 * quelle commande on parle. Repli e-mail si le chat n'est pas chargé (cf.
 * openSupportChat). Style surchargeable via `className` pour s'adapter aux
 * espaces client (tokens Tailwind) et livreur (palette CSS).
 */
export function OrderSupportButton({
  orderRef,
  label,
  className,
  attributes,
  subject,
  priority,
}: {
  orderRef?: string | null;
  label: string;
  className?: string;
  attributes?: SupportAttributes;
  /** Sujet court (ex. « Commande », « Livraison en cours »). */
  subject?: string | null;
  /** URGENT quand l'incident concerne une livraison/commande en cours. */
  priority?: "urgent" | "normal";
}) {
  return (
    <button
      type="button"
      onClick={() =>
        openSupportChat({
          orderRef: orderRef ?? null,
          attributes,
          subject: subject ?? undefined,
          priority,
        })
      }
      className={
        className ??
        "border-border bg-surface text-foreground hover:bg-surface-2 text-body-sm flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 font-bold shadow-sm transition-colors"
      }
    >
      <LifeBuoy className="text-primary-600 size-4" />
      {label}
    </button>
  );
}
