import { z } from "zod";
import { DAY_KEYS } from "@/lib/types";

// =============================================================================
// Profil du commerce (vitrine)
// =============================================================================
const optTrim = (max: number) =>
  z
    .union([z.literal(""), z.string().max(max, `Max ${max} caractères`)])
    .optional()
    .transform((v) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s === "" ? null : s;
    });

export const profileSchema = z.object({
  name: z
    .string({ message: "Le nom est requis" })
    .min(2, "Min 2 caractères")
    .max(80, "Max 80 caractères"),
  category: optTrim(60),
  wilaya_code: optTrim(2),
  commune: optTrim(80),
  address: optTrim(200),
  description_fr: optTrim(800),
  description_ar: optTrim(800),
  phone_public: z
    .union([
      z.literal(""),
      z.string().regex(/^[0-9+\s()-]{6,20}$/, "Numéro invalide"),
    ])
    .optional()
    .transform((v) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s === "" ? null : s;
    }),
});
export type ProfileInput = z.infer<typeof profileSchema>;

// =============================================================================
// Horaires d'ouverture — accepte du JSON sérialisé (string) ou direct
// =============================================================================
const slotSchema = z
  .object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Format attendu HH:MM"),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Format attendu HH:MM"),
  })
  .refine((s) => s.open < s.close, {
    message: "L'heure d'ouverture doit précéder la fermeture",
  });

export const openingHoursSchema = z.object(
  Object.fromEntries(
    DAY_KEYS.map((k) => [k, z.array(slotSchema).max(4)])
  ) as Record<(typeof DAY_KEYS)[number], z.ZodArray<typeof slotSchema>>
);
export type OpeningHoursInput = z.infer<typeof openingHoursSchema>;

/** Parse un payload form-data (string JSON) en horaires validés. */
export function parseOpeningHoursFromForm(raw: unknown): OpeningHoursInput {
  if (typeof raw !== "string") {
    throw new Error("Horaires manquants");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Horaires : JSON invalide");
  }
  return openingHoursSchema.parse(parsed);
}

// =============================================================================
// Règles de commande + créneaux de retrait
// =============================================================================
export const orderRulesSchema = z.object({
  min_order_da: z.coerce
    .number({ message: "Montant invalide" })
    .int("Entier en DA")
    .min(0, "Doit être ≥ 0")
    .max(1_000_000, "Max 1 000 000"),
  prep_time_min: z.coerce
    .number({ message: "Délai invalide" })
    .int("Entier en minutes")
    .min(0, "Doit être ≥ 0")
    .max(600, "Max 600 min"),
  accepts_cash: z
    .union([
      z.literal("on"),
      z.literal("off"),
      z.literal("true"),
      z.literal("false"),
      z.boolean(),
    ])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  accepts_online: z
    .union([
      z.literal("on"),
      z.literal("off"),
      z.literal("true"),
      z.literal("false"),
      z.boolean(),
    ])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  pickup_slot_minutes: z.coerce
    .number({ message: "Granularité invalide" })
    .int("Entier en minutes")
    .min(5, "Min 5 min")
    .max(240, "Max 240 min"),
  max_orders_per_slot: z
    .union([z.literal(""), z.coerce.number().int("Entier").min(1, "Min 1")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : (v as number))),
});
export type OrderRulesInput = z.infer<typeof orderRulesSchema>;

// =============================================================================
// Changement de mot de passe
// =============================================================================
export const passwordSchema = z
  .object({
    password: z
      .string({ message: "Mot de passe requis" })
      .min(8, "Min 8 caractères"),
    confirm: z.string({ message: "Confirmation requise" }),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirm"],
  });
export type PasswordInput = z.infer<typeof passwordSchema>;
