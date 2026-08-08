"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Interrupteur. Six versions locales existaient (`Toggle` ×5, `ToggleRow`),
 * toutes légèrement différentes.
 *
 * RTL : la pastille se déplace avec `translate-x` et `rtl:-translate-x`, donc
 * « activé » pousse toujours vers la fin de ligne, y compris en arabe.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Libellé accessible quand l'interrupteur n'a pas de texte visible associé. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:ring-primary-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        checked ? "bg-primary-600" : "bg-surface-3",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "bg-plain-white absolute start-0.5 size-5 rounded-full transition-transform",
          checked && "translate-x-5 rtl:-translate-x-5"
        )}
      />
    </button>
  );
}

/** Ligne « libellé + description + interrupteur », le motif de réglage courant. */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="text-body-sm text-foreground block font-bold">
          {title}
        </span>
        {description && (
          <span className="text-caption text-muted block leading-snug">
            {description}
          </span>
        )}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
