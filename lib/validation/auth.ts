import { z } from "zod";

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
  wilayaCode: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  city: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Renvoie le premier message d'erreur d'un ZodError, ou un message générique.
 */
export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides";
}
