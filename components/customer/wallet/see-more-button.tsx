"use client";

import { Loader2 } from "lucide-react";

/**
 * Bouton « Voir plus » des historiques paginés (cashback, fidélité, Coligo
 * Pay) : loading immédiat local (règle maison), jamais de toast.
 */
export function SeeMoreButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="border-border bg-surface text-foreground hover:bg-surface-2 rounded-control mt-3 flex h-11 w-full items-center justify-center gap-2 border text-sm font-bold transition disabled:opacity-60"
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}
