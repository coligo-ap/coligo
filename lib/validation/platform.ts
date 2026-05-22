import { z } from "zod";

// Les formulaires admin saisissent des POURCENTAGES (0–100) ; les actions
// convertissent en décimal (0–1) avant stockage.

const pct = z.coerce
  .number({ message: "Valeur invalide" })
  .min(0, "Doit être ≥ 0")
  .max(100, "Doit être ≤ 100");

export const platformSettingsSchema = z.object({
  commission_cash: pct,
  commission_online: pct,
  cashback_online: pct,
  cashback_cash: pct,
  chargily_fee: pct,
  max_debt_da: z.coerce
    .number({ message: "Seuil invalide" })
    .int("Entier en DA")
    .min(0, "Doit être ≥ 0"),
});

export type PlatformSettingsInput = z.infer<typeof platformSettingsSchema>;

const optPct = z
  .union([z.literal(""), pct])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : (v as number)));

export const merchantRatesSchema = z.object({
  commission_cash: optPct,
  commission_online: optPct,
  cashback_online: optPct,
  cashback_cash: optPct,
});

export type MerchantRatesInput = z.infer<typeof merchantRatesSchema>;

/** % (0–100) → décimal (0–1) arrondi à 4 décimales. */
export function pctToRate(percent: number): number {
  return Math.round((percent / 100) * 10000) / 10000;
}

/** décimal (0–1) → % pour l'affichage. */
export function rateToPct(rate: number | null | undefined): string {
  if (rate == null) return "";
  return String(Math.round(rate * 10000) / 100);
}
