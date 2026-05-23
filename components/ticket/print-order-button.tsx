"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
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
 * Bouton « Imprimer le ticket ». Navigue vers l'endpoint isolé
 * `/print/orders/[id]` qui rend UNIQUEMENT le ticket et déclenche
 * `window.print()` automatiquement. C'est la seule approche fiable sur
 * mobile (iOS Safari / Chrome Android) — pas de risque de capturer
 * l'app derrière le ticket.
 *
 * Le bouton fonctionne identique sur desktop : meme navigation, retour
 * automatique après l'impression (afterprint → history.back).
 *
 * Pour les impressions sans navigation utilisateur (auto-print depuis le
 * bridge Realtime), on continue d'utiliser `printOrderTicket()` (mount
 * in-place) — un event Realtime n'est pas un user gesture qui peut
 * naviguer.
 */
export function PrintOrderButton({
  order,
  width,
  copies = 1,
  variant = "outline",
  size = "md",
  label = "Imprimer le ticket",
  className,
}: Props) {
  const [navigating, setNavigating] = useState(false);

  function handle() {
    if (navigating) return;
    setNavigating(true);
    const params = new URLSearchParams({
      width: String(width),
      copies: String(copies),
    });
    if (typeof window !== "undefined") {
      params.set("back", window.location.pathname + window.location.search);
    }
    // Same-window navigation : pas de popup à débloquer, marche sur mobile,
    // et l'endpoint nous ramène ici via history.back() à la fin du print.
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
        disabled={navigating}
        aria-label="Imprimer le ticket"
        className={cn(base, "size-9 p-0", style, className)}
      >
        {navigating ? (
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
      disabled={navigating}
      className={cn(base, sized, style, className)}
    >
      {navigating ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Printer className="size-4" />
      )}
      {label}
    </button>
  );
}
