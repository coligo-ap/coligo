"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  // ReactNode (pas ComponentType) : un Server Component peut ainsi passer
  // <Printer className="size-4" /> au lieu de `Printer`. Une fonction Lucide
  // (forwardRef) ne traverse PAS la frontière server→client dans Next 15.
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Résumé à droite (« Auto : OFF · 58mm · 1 copie »). Optionnel. */
  summary?: React.ReactNode;
  /** Ouvert par défaut. */
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/**
 * Section dépliable de la page Paramètres. Pattern réutilisable pour
 * ajouter de nouveaux blocs (Notifications, Compte, etc.) sans refactor —
 * chaque section vit dans sa propre carte avec en-tête cliquable.
 */
export function SettingsSection({
  icon,
  title,
  description,
  summary,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-border bg-surface overflow-hidden rounded-[16px] border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-4 text-left transition-colors lg:px-5"
      >
        <div className="bg-primary-50 text-primary-700 flex size-9 shrink-0 items-center justify-center rounded-[10px] [&>svg]:size-4">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-sm font-semibold lg:text-base">
            {title}
          </h2>
          {description && (
            <p className="text-muted mt-0.5 text-xs">{description}</p>
          )}
        </div>
        {summary && (
          <div className="hidden shrink-0 items-center sm:flex">{summary}</div>
        )}
        <ChevronDown
          className={cn(
            "text-subtle size-5 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="border-border border-t bg-white px-4 py-5 lg:px-5 lg:py-6">
          {children}
        </div>
      )}
    </section>
  );
}
