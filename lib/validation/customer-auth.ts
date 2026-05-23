import { z } from "zod";

// Téléphone algérien : commence par 0 (5/6/7), ou +213 5/6/7..., 9 chiffres
// derrière le préfixe national. On accepte espaces / tirets / parenthèses.
const PHONE_RE = /^(?:\+?213|0)\s?(?:5|6|7)\s?(?:[0-9]\s?){8}$/;

export const customerLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email requis")
    .email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export const customerSignupSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Nom complet requis")
    .max(80, "Max 80 caractères"),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, "Numéro algérien invalide (ex. 0550 12 34 56)"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email requis")
    .email("Email invalide"),
  password: z.string().min(8, "Mot de passe : min 8 caractères"),
});
export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;

/** Normalise un téléphone algérien en format E.164 (+213...). */
export function normalizeAlgerianPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+213")) return digits;
  if (digits.startsWith("00213")) return "+" + digits.slice(2);
  if (digits.startsWith("0")) return "+213" + digits.slice(1);
  return digits;
}
