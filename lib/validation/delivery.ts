import { z } from "zod";

/**
 * Réglages livraison commerçant — validation Zod.
 * Le rayon est borné côté serveur par `delivery_max_radius_km` de
 * `platform_settings` (pas connaissable ici sans I/O ; on borne juste
 * au max raisonnable de 50 km — l'action serveur clamp ensuite).
 */
export const merchantDeliverySchema = z
  .object({
    delivery_enabled: z.boolean(),
    express_enabled: z.boolean(),
    tours_enabled: z.boolean(),
    delivery_radius_km: z.coerce
      .number({ message: "Rayon invalide" })
      .positive("Doit être > 0")
      .max(50, "Trop grand")
      .nullable()
      .optional()
      .transform((v) => (v == null ? null : v)),
  })
  .refine((v) => !v.delivery_enabled || v.express_enabled || v.tours_enabled, {
    message: "Active au moins Express ou Tournée",
    path: ["express_enabled"],
  })
  .refine((v) => !v.delivery_enabled || v.delivery_radius_km != null, {
    message: "Rayon requis si la livraison est activée",
    path: ["delivery_radius_km"],
  });

export type MerchantDeliveryInput = z.infer<typeof merchantDeliverySchema>;
