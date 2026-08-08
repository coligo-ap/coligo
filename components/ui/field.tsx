"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Champ de formulaire : libellé + contrôle + aide + erreur, avec le câblage
 * d'accessibilité (`htmlFor`, `aria-describedby`, `aria-invalid`) fait une
 * fois. Quinze composants `Field` privés étaient redéfinis fichier par
 * fichier, chacun oubliant une partie de ce câblage.
 *
 * L'erreur s'affiche EN LIGNE, sous le champ concerné — règle produit : pas de
 * toast pour une validation de formulaire, le message va là où est l'action.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  /** Doit correspondre à l'`id` du contrôle enfant. */
  htmlFor?: string;
  /** Aide affichée tant qu'il n'y a pas d'erreur. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && (
            <span aria-hidden className="text-danger-600 ms-0.5">
              *
            </span>
          )}
        </Label>
      )}
      {children}
      {error ? (
        <p id={errorId} className="text-caption text-danger-600 font-semibold">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-caption text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * Attributs à étaler sur le contrôle pour le relier à son `Field` :
 * `<Input {...fieldControlProps("email", { error })} />`.
 */
export function fieldControlProps(
  id: string,
  { error, hint }: { error?: unknown; hint?: unknown } = {}
) {
  return {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}
