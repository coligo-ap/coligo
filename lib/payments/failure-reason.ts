// =============================================================================
// Traduction des raisons d'échec Chargily en messages humains FR.
// =============================================================================
// Le webhook stocke une chaîne courte dans `orders.payment_failure_reason`
// (cf. extractFailureReason). Cette fonction la traduit pour l'affichage
// côté /checkout/failure et /commandes/[id].
//
// Si la raison est inconnue / vide, on renvoie un texte générique.
// =============================================================================

export function humanizeFailureReason(raw: string | null | undefined): {
  title: string;
  hint?: string;
} {
  if (!raw) {
    return {
      title: "Le paiement n'a pas abouti.",
      hint: "Aucun débit n'a eu lieu. Tu peux réessayer dès maintenant.",
    };
  }
  const code = raw.toLowerCase().trim();

  if (
    code.includes("insufficient") ||
    code.includes("solde") ||
    code.includes("balance")
  ) {
    return {
      title: "Solde insuffisant sur ta carte.",
      hint: "Vérifie ton compte bancaire, puis réessaie. Aucun débit n'a eu lieu.",
    };
  }
  if (
    code.includes("declined") ||
    code.includes("refus") ||
    code.includes("rejected")
  ) {
    return {
      title: "Ta banque a refusé la transaction.",
      hint: "Contacte ton agence ou essaie une autre carte. Aucun débit n'a eu lieu.",
    };
  }
  if (
    code.includes("cancel") ||
    code === "canceled" ||
    code === "user_canceled"
  ) {
    return {
      title: "Tu as annulé le paiement.",
      hint: "Tu peux réessayer maintenant ou choisir « Espèces au retrait ».",
    };
  }
  if (code.includes("expired") || code.includes("expir")) {
    return {
      title: "Le lien de paiement a expiré.",
      hint: "Pas de problème, on relance un nouveau paiement.",
    };
  }
  if (
    code.includes("invalid") ||
    code.includes("card") ||
    code.includes("carte")
  ) {
    return {
      title: "Carte invalide ou expirée.",
      hint: "Vérifie tes informations bancaires et réessaie.",
    };
  }
  if (code.includes("3ds") || code.includes("authentication")) {
    return {
      title: "Authentification 3DS échouée.",
      hint: "Ta banque a refusé la confirmation par SMS/app. Réessaie.",
    };
  }

  // Inconnu : générique sans afficher le code technique.
  return {
    title: "Le paiement n'a pas abouti.",
    hint: "Aucun débit n'a eu lieu. Tu peux réessayer dès maintenant.",
  };
}

// =============================================================================
// extractFailureReason — best-effort sur les payloads webhook Chargily.
// =============================================================================
// Chargily Pay v2 ne documente PAS un champ unique standardisé pour la raison
// d'échec. On scrute les emplacements les plus probables et on renvoie une
// chaîne stable (qu'on stocke en DB) — la traduction humaine est faite plus
// tard par humanizeFailureReason().
//
// Si rien n'est trouvé, on renvoie l'event.type pour avoir au moins une trace
// ("checkout.canceled" → mappé à "canceled" par humanize).
// =============================================================================
export function extractFailureReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const p = payload as Record<string, unknown>;
  // Cas 1 : champ direct dans le data (improbable mais on essaye)
  const data = (p.data as Record<string, unknown> | undefined) ?? {};
  for (const key of [
    "failure_reason",
    "failure_message",
    "error_message",
    "decline_reason",
    "cancel_reason",
  ]) {
    if (typeof data[key] === "string" && (data[key] as string).length > 0) {
      return (data[key] as string).slice(0, 200);
    }
  }
  // Cas 2 : objet error imbriqué
  const error = data.error as Record<string, unknown> | undefined;
  if (error && typeof error.message === "string") {
    return error.message.slice(0, 200);
  }
  // Cas 3 : on dérive du type d'event
  if (typeof p.type === "string") {
    if (p.type === "checkout.canceled") return "canceled";
    if (p.type === "checkout.failed") return "unknown";
  }
  return "unknown";
}
