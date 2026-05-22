import { z } from "zod";

export const payoutSchema = z.object({
  amount_da: z.coerce
    .number({ message: "Montant invalide" })
    .int("Le montant doit être un entier (en DA)")
    .positive("Le montant doit être positif"),
  method: z.enum(["ccp", "baridimob", "bank"], {
    message: "Méthode de versement invalide",
  }),
  details: z
    .string()
    .trim()
    .min(3, "Renseignez vos coordonnées (n° CCP / RIB)")
    .max(500, "Coordonnées trop longues"),
});

export type PayoutInput = z.infer<typeof payoutSchema>;
