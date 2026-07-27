import { z } from "zod";
import { DZ_PHONE_ERROR } from "@/lib/dz/phone";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email requis")
    .email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email requis")
    .email("Email invalide"),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères"),
  merchantName: z.string().trim().min(1, "Le nom du commerce est requis"),
  managerName: z
    .string()
    .trim()
    .min(1, "Le nom et prénom du responsable sont requis"),
  // Téléphone du commerce (forme canonique PhoneField : 0XXXXXXXXX mobile DZ
  // ou E.164). Optionnel côté schéma (compat clients déjà chargés sans le
  // champ) — le wizard, lui, l'exige à l'étape 1.
  phone: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^0[567]\d{8}$/.test(v) || /^\+\d{8,15}$/.test(v),
      DZ_PHONE_ERROR
    ),
  // Position EXACTE choisie sur la carte (obligatoire). Chaînes non vides ;
  // converties + bornées côté action.
  latitude: z.string().trim().min(1, "Choisissez votre position sur la carte"),
  longitude: z.string().trim().min(1, "Choisissez votre position sur la carte"),
  address: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  category: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  wilayaCode: z.string().trim().min(1, "La wilaya est requise"),
  city: z.string().trim().min(1, "La commune est requise"),
});

/**
 * Champs BOUTIQUE seuls (sans email/mot de passe) — complétion d'inscription
 * après une connexion Google sur le portail commerçant (/signup/boutique).
 */
export const shopSchema = signupSchema.omit({ email: true, password: true });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ShopInput = z.infer<typeof shopSchema>;

/**
 * Renvoie le premier message d'erreur d'un ZodError, ou un message générique.
 */
export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides";
}
