"use client";

// =============================================================================
// IDV — carte « vérifiez votre identité » posée dans les écrans qui n'ont PAS
// de dépôt de pièces (compte commerçant, compte livreur, compte chauffeur,
// écran d'attente d'inscription). Même bloc d'état et même bouton unique que
// l'étape d'inscription : un seul système, trois espaces.
//
// Elle disparaît d'elle-même quand la vérification n'est pas publiée pour le
// profil, et se réduit à une confirmation discrète quand l'identité est déjà
// vérifiée (le bouton, lui, n'existe plus : il n'y a plus rien à faire).
// =============================================================================

import { IdvScope } from "./idv-theme";
import type { IdvChoiceState } from "@/lib/idv/ui-state";
import { IdvPrimaryButton, IdvStatusBlock } from "./idv-verify-step";

export function IdvVerifyCard({ idv }: { idv: IdvChoiceState }) {
  if (!idv.available) return null;

  return (
    <IdvScope className="space-y-2.5">
      <IdvStatusBlock idv={idv} />
      {/* Rien à afficher une fois l'identité vérifiée : le bouton partagé rend
          alors ses enfants — ici, aucun. */}
      <IdvPrimaryButton idv={idv} method="instant">
        <></>
      </IdvPrimaryButton>
    </IdvScope>
  );
}
