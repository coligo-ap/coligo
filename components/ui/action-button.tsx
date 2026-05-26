"use client";

import * as React from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import type { ButtonLabels, ButtonState } from "@/lib/hooks/use-action-button";

/**
 * Bouton qui affiche son propre statut (idle / pending / success / error)
 * au lieu d'afficher un toast. Voir `use-action-button.ts` pour les hooks
 * qui pilotent le state.
 *
 * - En `pending` : disabled + loader + texte "Enregistrement…"
 * - En `success` : couleur verte + check + texte "Enregistré ✓" (auto-reset)
 * - En `error`   : couleur rouge + croix + texte "Erreur, réessaie"
 * - En `idle`    : variant/couleur d'origine
 *
 * Hérite de toutes les props du `<Button>`. Le `disabled` est forcé pendant
 * pending mais le caller peut aussi disabled manuellement.
 */
export type ActionButtonProps = {
  state: ButtonState;
  labels: ButtonLabels;
  /** Optionnel : remplace l'icône idle (défaut : aucune). */
  idleIcon?: React.ReactNode;
} & Omit<ButtonProps, "children">;

const DEFAULT_LABELS: Required<ButtonLabels> = {
  idle: "Enregistrer",
  pending: "Enregistrement…",
  success: "Enregistré ✓",
  error: "Erreur, réessaie",
};

export const ActionButton = React.forwardRef<
  HTMLButtonElement,
  ActionButtonProps
>(function ActionButton(
  { state, labels, idleIcon, className, disabled, variant, ...rest },
  ref
) {
  const merged = { ...DEFAULT_LABELS, ...labels };
  const text = merged[state];

  const icon =
    state === "pending" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : state === "success" ? (
      <Check className="size-4" />
    ) : state === "error" ? (
      <X className="size-4" />
    ) : (
      idleIcon
    );

  // Tons visuels : on override quand state ∈ {success, error}. On force ces
  // classes en !important via Tailwind '!' pour battre le variant par défaut.
  const stateClass =
    state === "success"
      ? "!bg-success-600 !text-white hover:!bg-success-600"
      : state === "error"
        ? "!bg-danger-600 !text-white hover:!bg-danger-600"
        : "";

  return (
    <Button
      ref={ref}
      {...rest}
      variant={variant}
      disabled={state === "pending" || disabled}
      className={cn(className, stateClass)}
      aria-live="polite"
    >
      {icon}
      {text}
    </Button>
  );
});
