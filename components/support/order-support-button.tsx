"use client";

import { LifeBuoy } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";

/**
 * Bouton « Contacter le support » rattaché à UNE commande : ouvre le live chat
 * Tawk.to (lanceur flottant masqué) en injectant la référence de la commande
 * pour que l'agent sache de quelle commande on parle. Repli e-mail si le chat
 * n'est pas chargé (cf. openSupportChat). Style surchargeable via `className`
 * pour s'adapter aux espaces client (tokens Tailwind) et livreur (palette CSS).
 */
export function OrderSupportButton({
  orderRef,
  label,
  className,
}: {
  orderRef?: string | null;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openSupportChat({ orderRef: orderRef ?? null })}
      className={
        className ??
        "border-border bg-surface text-foreground hover:bg-surface-2 flex w-full items-center justify-center gap-2 rounded-[16px] border px-4 py-3 text-[13px] font-bold shadow-sm transition-colors"
      }
    >
      <LifeBuoy className="text-primary-600 size-4" />
      {label}
    </button>
  );
}
