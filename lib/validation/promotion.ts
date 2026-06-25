import { z } from "zod";
import type { DiscountKind, PromotionType } from "@/lib/types";

// --- Helpers --------------------------------------------------------------

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

/**
 * Champ date "datetime-local" → ISO (UTC) ou null.
 * La valeur est interprétée en heure d'ALGÉRIE (UTC+1, sans heure d'été), pas
 * en heure locale de l'appareil — cohérent avec l'affichage du formulaire
 * (toAlgiersInput). Sans ça, un appareil mal réglé décalait l'heure de début.
 */
const dateField = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Date invalide" });
      return z.NEVER;
    }
    // Suffixe +01:00 = heure d'Alger fixe → instant UTC correct quel que soit
    // le fuseau de l'appareil.
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+01:00`);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Date invalide" });
      return z.NEVER;
    }
    return d.toISOString();
  });

const optionalPositiveInt = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : (v as number)));

const discountKindSchema = z.enum(["percent", "amount"]);

const discountValueSchema = z.coerce
  .number({ message: "Valeur de réduction invalide" })
  .positive("La valeur doit être positive");

const productIdsSchema = z
  .array(z.string().uuid())
  .min(1, "Sélectionnez au moins un produit");

// --- Schémas par type -----------------------------------------------------

const baseFields = {
  title_fr: z.string().trim().min(1, "Le titre (FR) est requis"),
  title_ar: optionalText,
  starts_at: dateField,
  ends_at: dateField,
};

const productDiscountSchema = z
  .object({
    type: z.literal("product_discount"),
    discount_kind: discountKindSchema,
    discount_value: discountValueSchema,
    product_ids: productIdsSchema,
    ...baseFields,
  })
  .superRefine(refineKindValueAndDates);

const promoCodeSchema = z
  .object({
    type: z.literal("promo_code"),
    code: z
      .string()
      .trim()
      .min(3, "Le code doit faire au moins 3 caractères")
      .max(32, "Le code est trop long")
      .regex(/^[A-Za-z0-9_-]+$/, "Lettres, chiffres, - et _ uniquement")
      .transform((v) => v.toUpperCase()),
    discount_kind: discountKindSchema,
    discount_value: discountValueSchema,
    max_uses: optionalPositiveInt,
    max_uses_per_customer: optionalPositiveInt,
    min_subtotal: optionalPositiveInt,
    ...baseFields,
  })
  .superRefine(refineKindValueAndDates);

const quantityOfferSchema = z
  .object({
    type: z.literal("quantity_offer"),
    buy_qty: z.coerce
      .number({ message: "Quantité achetée invalide" })
      .int()
      .positive("« Achetés » doit être au moins 1"),
    get_qty: z.coerce
      .number({ message: "Quantité offerte invalide" })
      .int()
      .positive("« Offerts » doit être au moins 1"),
    product_ids: productIdsSchema,
    ...baseFields,
  })
  .superRefine((data, ctx) => {
    refineDatesOnly(data, ctx);
  });

/** Règle commune : % entre 1 et 100, montant > 0, dates cohérentes. */
function refineKindValueAndDates(
  data: {
    discount_kind: DiscountKind;
    discount_value: number;
    starts_at?: string | null;
    ends_at?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.discount_kind === "percent") {
    if (data.discount_value < 1 || data.discount_value > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["discount_value"],
        message: "Le pourcentage doit être entre 1 et 100",
      });
    }
  }
  refineDatesOnly(data, ctx);
}

function refineDatesOnly(
  data: { starts_at?: string | null; ends_at?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.starts_at && data.ends_at && data.starts_at >= data.ends_at) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_at"],
      message: "La date de fin doit être après la date de début",
    });
  }
}

export type PromotionInput =
  | z.infer<typeof productDiscountSchema>
  | z.infer<typeof promoCodeSchema>
  | z.infer<typeof quantityOfferSchema>;

export type ParsedPromotion =
  | { success: true; data: PromotionInput }
  | { success: false; error: string };

type AnyParseResult =
  | ReturnType<typeof productDiscountSchema.safeParse>
  | ReturnType<typeof promoCodeSchema.safeParse>
  | ReturnType<typeof quantityOfferSchema.safeParse>;

function normalize(result: AnyParseResult): ParsedPromotion {
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues[0]?.message ?? "Données invalides",
    };
  }
  return { success: true, data: result.data };
}

/** Parse un FormData de promotion selon son `type`. */
export function parsePromotionForm(formData: FormData): ParsedPromotion {
  const type = formData.get("type") as PromotionType | null;

  const common = {
    title_fr: formData.get("title_fr") ?? "",
    title_ar: formData.get("title_ar") ?? "",
    starts_at: formData.get("starts_at") ?? "",
    ends_at: formData.get("ends_at") ?? "",
  };
  const productIds = formData.getAll("product_ids").map(String);

  switch (type) {
    case "product_discount":
      return normalize(
        productDiscountSchema.safeParse({
          type,
          discount_kind: formData.get("discount_kind"),
          discount_value: formData.get("discount_value"),
          product_ids: productIds,
          ...common,
        })
      );
    case "promo_code":
      return normalize(
        promoCodeSchema.safeParse({
          type,
          code: formData.get("code") ?? "",
          discount_kind: formData.get("discount_kind"),
          discount_value: formData.get("discount_value"),
          max_uses: formData.get("max_uses") ?? "",
          max_uses_per_customer: formData.get("max_uses_per_customer") ?? "",
          min_subtotal: formData.get("min_subtotal") ?? "",
          ...common,
        })
      );
    case "quantity_offer":
      return normalize(
        quantityOfferSchema.safeParse({
          type,
          buy_qty: formData.get("buy_qty"),
          get_qty: formData.get("get_qty"),
          product_ids: productIds,
          ...common,
        })
      );
    default:
      return { success: false, error: "Type de promotion invalide" };
  }
}
