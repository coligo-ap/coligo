"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { printOrderTicket } from "@/lib/ticket/print-order";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  order: TicketOrder;
  width: PrintWidth;
  copies?: number;
  appName?: string;
  variant?: "primary" | "outline" | "icon";
  size?: "sm" | "md";
  label?: string;
  className?: string;
};

/**
 * Bouton « Imprimer le ticket ». Délègue à `printOrderTicket()` qui passe par
 * `lib/native/printer.ts` — donc PWA aujourd'hui (dialogue système),
 * SDK Sunmi demain (impression directe), sans changer ce composant.
 */
export function PrintOrderButton({
  order,
  width,
  copies = 1,
  appName,
  variant = "outline",
  size = "md",
  label = "Imprimer le ticket",
  className,
}: Props) {
  const [printing, setPrinting] = useState(false);

  async function handle() {
    if (printing) return;
    setPrinting(true);
    try {
      await printOrderTicket(order, { width, copies, appName });
    } catch (err) {
      toast.error("Impression impossible.");
      console.error(err);
    } finally {
      setPrinting(false);
    }
  }

  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:opacity-50";
  const sized = size === "sm" ? "h-9 px-3 text-sm" : "h-10 px-4 text-sm";
  const style =
    variant === "primary"
      ? "bg-primary-600 hover:bg-primary-700 text-white"
      : variant === "icon"
        ? "size-9 text-muted hover:bg-surface-2 hover:text-foreground p-0"
        : "border border-border-strong hover:bg-surface-2 text-foreground bg-white";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={printing}
        aria-label="Imprimer le ticket"
        className={cn(base, "size-9 p-0", style, className)}
      >
        {printing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Printer className="size-4" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={printing}
      className={cn(base, sized, style, className)}
    >
      {printing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Printer className="size-4" />
      )}
      {label}
    </button>
  );
}
