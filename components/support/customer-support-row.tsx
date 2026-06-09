"use client";

import { ChevronRight, LifeBuoy } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";

/**
 * Entrée « Aide / Support » de la page Compte client — ouvre le live chat Tawk.to
 * (lanceur flottant masqué, on passe par ce bouton). Style aligné sur MenuRow.
 */
export function CustomerSupportRow({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openSupportChat()}
      className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
        <LifeBuoy className="size-[19px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[15px] font-extrabold tracking-tight">
          {title}
        </span>
        <span className="text-muted block truncate text-xs font-medium">
          {subtitle}
        </span>
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
    </button>
  );
}
