// Résolution des taux côté app (miroir de la fonction SQL resolve_rate) :
// taux du commerçant s'il est défini, sinon taux global par défaut.

import type {
  MerchantRateOverrides,
  PlatformSettings,
  RateKey,
} from "@/lib/types";

export function resolveRate(
  overrides: Partial<MerchantRateOverrides> | null | undefined,
  settings: PlatformSettings,
  key: RateKey
): number {
  // chargily_fee est GLOBAL uniquement (coût de Coligo, pas surchargé).
  if (key === "chargily_fee") return settings.chargily_fee;
  const override = overrides?.[key];
  return override != null ? override : settings[key];
}
