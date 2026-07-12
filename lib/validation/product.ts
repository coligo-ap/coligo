import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const optionalImageUrl = z
  .string()
  .trim()
  .url("URL d'image invalide")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const optionalUuid = z
  .string()
  .trim()
  .uuid("Catégorie invalide")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const optionalStock = z
  .union([z.literal(""), z.coerce.number().int().min(0)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : (v as number)));

const optionalQty = z
  .union([z.literal(""), z.coerce.number().positive("Quantité invalide")])
  .optional()
  .transform((v) =>
    v === "" || v === undefined ? null : Math.round((v as number) * 100) / 100
  );

export const productSchema = z
  .object({
    name_fr: z.string().trim().min(1, "Le nom (FR) est requis"),
    name_ar: optionalText,
    description_fr: optionalText,
    description_ar: optionalText,
    price_da: z.coerce
      .number({ message: "Prix invalide" })
      .int("Le prix doit être un entier (en DA)")
      .min(0, "Le prix ne peut pas être négatif"),
    unit: z.enum(["piece", "kg", "l", "m", "custom"]),
    category_id: optionalUuid,
    stock_qty: optionalStock,
    /** Quantité minimum par ligne (unité de vente). NULL = pas de minimum. */
    min_qty: optionalQty,
    /** Quantité maximum par commande (somme des lignes). NULL = pas de max. */
    max_qty: optionalQty,
    image_url: optionalImageUrl,
    /** Code-barres produit (EAN-8/13, UPC) — scanné ou saisi, NULL = absent.
     *  Alimente le match EXACT du scan client (phase 2, mig 0362). */
    barcode: z
      .string()
      .optional()
      .transform((v) => {
        const digits = (v ?? "").replace(/\D/g, "");
        return digits ? digits : null;
      })
      .refine((v) => v === null || (v.length >= 8 && v.length <= 14), {
        message: "Code-barres invalide (8 à 14 chiffres).",
      }),
    is_available: z
      .union([
        z.literal("on"),
        z.literal("true"),
        z.literal("false"),
        z.boolean(),
      ])
      .optional()
      .transform((v) => v === true || v === "on" || v === "true"),
  })
  .refine(
    (d) => d.min_qty == null || d.max_qty == null || d.min_qty <= d.max_qty,
    {
      message: "Le minimum ne peut pas dépasser le maximum.",
      path: ["min_qty"],
    }
  );

export type ProductInput = z.infer<typeof productSchema>;

export const categorySchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis"),
  description: optionalText,
  image_url: optionalImageUrl,
});

export type CategoryInput = z.infer<typeof categorySchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides";
}
