// =============================================================================
// Politique de dette ESPÈCES commerçant — calcul PUR des seuils (B + A).
// =============================================================================
// Un commerçant encaisse du cash → il doit à Coligo la commission (+ frais de
// service) de ces ventes. Ses ventes EN LIGNE résorbent automatiquement cette
// dette (netting, B). Mais un commerçant 100 % espèces ne se nettoie jamais →
// sa dette croît sans fin. On plafonne (A) :
//   - dette = max(0, −solde wallet)  (cohérent avec le « Vous devez à Coligo »)
//   - cap   = platform_settings.max_debt_da (0 = politique désactivée)
//   - seuil doux (warning) = cap × softRatio → on prévient
//   - seuil dur (blocked)  = cap → on bloque les NOUVELLES commandes espèces
//     (les commandes EN LIGNE restent permises, elles réduisent la dette).
// Le calcul est répliqué côté serveur (trigger bypass-proof, mig 0269) ; ce
// helper sert l'UX (bandeau /finances).
// =============================================================================

export type CashDebtState = "clear" | "warning" | "blocked";

export type CashDebtStatus = {
  /** Dette espèces courante (>= 0). */
  debt: number;
  /** Plafond dur (0 = politique désactivée). */
  cap: number;
  /** Seuil d'avertissement (cap × softRatio). */
  softThreshold: number;
  state: CashDebtState;
  /** Marge de dette espèces encore tolérée avant blocage. */
  remaining: number;
};

/**
 * @param debt     Dette espèces = max(0, −solde wallet).
 * @param cap      platform_settings.max_debt_da (0 → désactivé).
 * @param softRatio Part du cap déclenchant l'avertissement (défaut 0,8).
 */
export function cashDebtStatus(
  debt: number,
  cap: number,
  softRatio = 0.8
): CashDebtStatus {
  const d = Math.max(0, Math.round(debt));
  const c = Math.max(0, Math.round(cap));
  const soft = Math.round(c * softRatio);

  let state: CashDebtState = "clear";
  if (c > 0) {
    if (d >= c) state = "blocked";
    else if (d >= soft) state = "warning";
  }

  return {
    debt: d,
    cap: c,
    softThreshold: soft,
    state,
    remaining: Math.max(0, c - d),
  };
}
