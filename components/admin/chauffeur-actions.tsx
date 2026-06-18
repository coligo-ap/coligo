"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, Snowflake, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrompt } from "@/components/ui/confirm";
import {
  setChauffeurVerified,
  setChauffeurFrozen,
  setChauffeurBlocked,
  freezeChauffeurWithReason,
} from "@/app/admin/chauffeurs/actions";

/**
 * Boutons d'action sur un chauffeur (vérifier / geler / bloquer).
 * Inline : pas de toast — l'erreur s'affiche sous les boutons.
 */
export function ChauffeurActions({
  chauffeurId,
  isVerified,
  isFrozen,
  isBlocked,
}: {
  chauffeurId: string;
  isVerified: boolean;
  isFrozen: boolean;
  isBlocked: boolean;
}) {
  const prompt = usePrompt();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => setChauffeurVerified(chauffeurId, !isVerified))
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
            isVerified
              ? "bg-success-50 text-success-700 hover:bg-success-100"
              : "bg-primary-600 hover:bg-primary-700 text-white"
          )}
        >
          <BadgeCheck className="size-3.5" />
          {isVerified ? "Vérifié" : "Vérifier"}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            // Gel AVEC MOTIF (affiché à l'écran « Compte gelé » du chauffeur).
            if (!isFrozen) {
              const motif = await prompt({
                title: "Geler ce compte",
                message: "Motif du gel (affiché au chauffeur).",
                initialValue:
                  "Comportement signalé / non-respect des conditions",
                multiline: true,
              });
              if (motif == null) return;
              run(() => freezeChauffeurWithReason(chauffeurId, motif));
            } else {
              run(() => setChauffeurFrozen(chauffeurId, false));
            }
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
            isFrozen
              ? "bg-warning-100 text-warning-800 hover:bg-warning-200"
              : "text-muted hover:bg-surface-2"
          )}
        >
          <Snowflake className="size-3.5" />
          {isFrozen ? "Gelé" : "Geler"}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => setChauffeurBlocked(chauffeurId, !isBlocked))
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
            isBlocked
              ? "bg-danger-600 hover:bg-danger-700 text-white"
              : "text-muted hover:bg-surface-2"
          )}
        >
          <Ban className="size-3.5" />
          {isBlocked ? "Bloqué" : "Bloquer"}
        </button>
      </div>
      {error && <p className="text-danger-600 text-xs">{error}</p>}
    </div>
  );
}
