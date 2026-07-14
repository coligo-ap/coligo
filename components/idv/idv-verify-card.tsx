"use client";

// =============================================================================
// IDV — carte « vérifiez votre identité » posée dans les écrans qui n'ont PAS
// de dépôt de pièces (compte commerçant, comptes livreur/chauffeur, écran
// d'attente d'inscription). Même bloc d'état et même bouton unique que l'étape
// d'inscription : un seul système, trois espaces.
//
// Elle disparaît d'elle-même quand la vérification n'est pas publiée pour le
// profil, et se réduit à une confirmation discrète quand l'identité est déjà
// vérifiée (le bouton n'existe plus : il n'y a plus rien à faire).
//
// REFUS : ici il n'y a pas de dossier de pièces à envoyer — le recours consiste
// donc à faire EXAMINER PAR L'ÉQUIPE les captures de la tentative refusée. Un
// refus automatique n'est jamais une impasse.
// =============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck } from "lucide-react";
import type { IdvChoiceState } from "@/lib/idv/ui-state";
import { requestIdvManualReview } from "@/app/idv/actions";
import { IdvScope } from "./idv-theme";
import { IdvPrimaryButton, IdvStatusBlock } from "./idv-verify-step";

export function IdvVerifyCard({
  idv,
  profile,
}: {
  idv: IdvChoiceState;
  profile: "driver" | "chauffeur" | "merchant";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!idv.available) return null;

  const askHumanReview = () => {
    setError(null);
    startTransition(async () => {
      const res = await requestIdvManualReview(profile);
      if (!res.ok) {
        setError(res.error ?? "Demande impossible.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <IdvScope className="space-y-2.5">
      <IdvStatusBlock idv={idv} />

      {/* Rien à afficher une fois l'identité vérifiée : le bouton partagé rend
          alors ses enfants — ici, aucun. */}
      <IdvPrimaryButton idv={idv} method="instant" busy={pending}>
        <></>
      </IdvPrimaryButton>

      {idv.rejected && (
        <>
          <button
            type="button"
            onClick={askHumanReview}
            disabled={pending}
            className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] border text-[13.5px] font-bold disabled:opacity-50"
            style={{
              borderColor: "var(--idv-line)",
              background: "var(--idv-card)",
              color: "var(--idv-ink)",
            }}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserCheck className="size-4" />
            )}
            Faire examiner par l&apos;équipe · 24 à 72 h
          </button>
          {error && (
            <p
              className="text-[12px] font-bold"
              style={{ color: "var(--idv-bad)" }}
            >
              {error}
            </p>
          )}
        </>
      )}
    </IdvScope>
  );
}
