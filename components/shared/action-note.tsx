"use client";

import { useEffect, useState } from "react";

/**
 * Statut inline pour les ACTIONS DE LISTE / boutons (supprimer, valider, refuser,
 * approuver une ligne…) — remplace les toasts par un message qui vit DANS le
 * composant, près de l'action, auto-effacé après quelques secondes (règle
 * produit : « action sur un bouton → message inline, pas de toast »). Partagé
 * entre les espaces (admin, commerçant…).
 *
 * Le SUCCÈS n'a souvent pas besoin de note quand la ligne change/disparaît
 * visiblement (via `router.refresh()`) : dans ce cas, ne pas en poser. La note
 * sert surtout à porter l'ERREUR (rare) là où il n'y a pas de slot inline
 * naturel dans un tableau dense, et les résultats chiffrés sans effet visible.
 */
export type ActionNote = { ok: boolean; text: string } | null;

export function useActionNote(
  resetMs = 3500
): [ActionNote, (n: ActionNote) => void] {
  const [note, setNote] = useState<ActionNote>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), resetMs);
    return () => clearTimeout(t);
  }, [note, resetMs]);
  return [note, setNote];
}

export function ActionNote({
  note,
  className = "",
}: {
  note: ActionNote;
  className?: string;
}) {
  if (!note) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-caption font-medium ${
        note.ok ? "text-success-700" : "text-danger-600"
      } ${className}`}
    >
      {note.text}
    </p>
  );
}
