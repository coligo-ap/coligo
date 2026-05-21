import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

export const productSchema = z.object({
  name_fr: z.string().trim().min(1, "Le nom (FR) est requis"),
  name_ar: optionalText,
  description_fr: optionalText,
  description_ar: optionalText,
  price_da: z.coerce
    .number({ message: "Prix invalide" })
    .int("Le prix doit être un entier (en DA)")
    .min(0, "Le prix ne peut pas être négatif"),
  unit: z.enum(["piece", "kg", "l", "m", "custom"]),
  category: optionalText,
  image_url: z
    .string()
    .trim()
    .url("URL d'image invalide")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  is_available: z
    .union([
      z.literal("on"),
      z.literal("true"),
      z.literal("false"),
      z.boolean(),
    ])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
});

export type ProductInput = z.infer<typeof productSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides";
}
