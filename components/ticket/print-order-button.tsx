"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { hasNativePrinterBridge } from "@/lib/native/context";
import { printOrderTicket } from "@/lib/ticket/print-order";

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
 * Bouton « Imprimer le ticket ».
 *
 * Deux voies selon l'environnement :
 *
 *  - APK Capacitor (Sunmi) : appel direct à `printOrderTicket()` qui passe
 *    par le plugin natif `SunmiPrinter` → impression thermique sans
 *    dialogue. On NE PEUT PAS naviguer vers `/print/orders/[id]` ici :
 *    la route serveur fait `window.print()`, no-op dans le WebView
 *    Capacitor, et le pont JS↔natif resterait inerte.
 *
 *  - Web / desktop / mobile navigateur : navigation vers l'endpoint isolé
 *    `/print/orders/[id]` qui rend UNIQUEMENT le ticket et déclenche
 *    `window.print()` automatiquement. C'est l'approche fiable sur
 *    Safari iOS / Chrome Android — pas de risque de capturer l'app
 *    derrière le ticket.
 *
 * Pour les impressions sans navigation utilisateur (auto-print depuis le
 * bridge Realtime), on utilise déjà `printOrderTicket()` directement —
 * un event Realtime n'est pas un user gesture qui peut naviguer.
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
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);

    // APK Capacitor : on imprime directement via le pont natif. La
    // navigation vers une page serveur isolée court-circuiterait le pont
    // JS↔natif (window.print() est no-op dans le WebView Capacitor).
    if (hasNativePrinterBridge()) {
      try {
        await printOrderTicket(order, { width, copies, appName });
      } finally {
        setBusy(false);
      }
      return;
    }

    // Web : page d'impression isolée + window.print() natif du navigateur.
    const params = new URLSearchParams({
      width: String(width),
      copies: String(copies),
    });
    if (typeof window !== "undefined") {
      params.set("back", window.location.pathname + window.location.search);
    }
    window.location.href = `/print/orders/${order.id}?${params.toString()}`;
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
        disabled={busy}
        aria-label="Imprimer le ticket"
        className={cn(base, "size-9 p-0", style, className)}
      >
        {busy ? (
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
      disabled={busy}
      className={cn(base, sized, style, className)}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Printer className="size-4" />
      )}
      {label}
    </button>
  );
}
