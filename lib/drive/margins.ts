/**
 * SIMULATEUR DE MARGE Drive (analyse finance, garde-fou n°2) : marge
 * plateforme par course = commission(plan) − cashback (plafonné par la
 * commission) − frais Chargily (en ligne, portés par la plateforme).
 * Utilisé côté admin (aperçu live) ET côté serveur (enregistrement BLOQUANT).
 */
export function simulateMargins(cfg: {
  free_rate: number;
  plan_pro_rate: number;
  plan_premium_rate: number;
  cashback_rate: number;
  chargily_fee: number;
  basket: number;
}): { plan: string; cash: number; online: number }[] {
  const plans = [
    ["Gratuit", cfg.free_rate],
    ["Pro", cfg.plan_pro_rate],
    ["Premium", cfg.plan_premium_rate],
  ] as const;
  return plans.map(([plan, rate]) => {
    const commission = Math.round(cfg.basket * rate);
    const cashback = Math.min(
      Math.round(cfg.basket * cfg.cashback_rate),
      commission
    );
    return {
      plan,
      cash: commission - cashback,
      online: commission - cashback - Math.round(cfg.basket * cfg.chargily_fee),
    };
  });
}
