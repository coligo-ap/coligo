"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Check,
  Gift,
  Layers,
  Leaf,
  Loader2,
  Search,
  Ticket,
  Timer,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PROMOTION_TYPE_META,
  type DiscountKind,
  type PromotionType,
  type PromotionWithProducts,
} from "@/lib/types";
import type { ProductLite } from "@/lib/data/promotions";
import { TranslateArButton } from "@/components/merchant/translate-ar-button";
import {
  createPromotion,
  updatePromotion,
  type PromotionFormState,
} from "@/app/(merchant)/promotions/actions";

const initialState: PromotionFormState = {};

const TYPE_ICON: Record<PromotionType, typeof BadgePercent> = {
  product_discount: BadgePercent,
  promo_code: Ticket,
  quantity_offer: Layers,
  free_gift: Gift,
  free_delivery: Truck,
  flash_sale: Timer,
  anti_gaspillage: Leaf,
};

const TYPES: PromotionType[] = [
  "flash_sale",
  "product_discount",
  "anti_gaspillage",
  "promo_code",
  "quantity_offer",
  "free_gift",
  "free_delivery",
];

/** Types = « réduction produit » (mêmes champs : réduction + produits). */
const PRODUCT_DISCOUNT_TYPES: PromotionType[] = [
  "product_discount",
  "flash_sale",
  "anti_gaspillage",
];

// La plateforme fonctionne en heure d'ALGÉRIE (UTC+1, sans heure d'été) — pas
// en heure locale de l'appareil (qui peut être mal réglé, ex. Sunmi). Les champs
// « datetime-local » des promos sont donc affichés ET interprétés en heure
// d'Alger, indépendamment du fuseau de l'appareil. Voir parseDateAlgiers côté
// validation (suffixe +01:00) — les deux doivent rester cohérents.
const ALGIERS_TZ = "Africa/Algiers";

/** Formate un instant (Date) en chaîne « datetime-local » à l'heure d'Alger. */
function toAlgiersInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALGIERS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toAlgiersInput(d);
}

/** Date/heure actuelle (heure d'Alger) au format de l'input « datetime-local ». */
function nowLocalInput(): string {
  return toAlgiersInput(new Date());
}

export function PromotionForm({
  products,
  promotion,
}: {
  products: ProductLite[];
  promotion?: PromotionWithProducts;
}) {
  const isEdit = !!promotion;
  const router = useRouter();

  const [type, setType] = useState<PromotionType | null>(
    promotion?.type ?? null
  );

  // Période : « Début » contrôlé pour pouvoir le pré-remplir avec l'heure
  // actuelle à la création (après montage → pas d'écart d'hydratation).
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInput(promotion?.starts_at ?? null)
  );
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInput(promotion?.ends_at ?? null)
  );
  useEffect(() => {
    if (!isEdit && !startsAt) setStartsAt(nowLocalInput());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // VENTE FLASH : le commerçant choisit une DURÉE (heures/minutes, 24 h max),
  // pas une date — la vente démarre MAINTENANT et finit dans `flashMinutes`.
  // En édition : initialisée sur le temps RESTANT (borné 5 min .. 24 h).
  const [flashMinutes, setFlashMinutes] = useState<number>(() => {
    if (promotion?.type === "flash_sale" && promotion.ends_at) {
      const left = Math.round(
        (new Date(promotion.ends_at).getTime() - Date.now()) / 60000
      );
      return Math.min(24 * 60, Math.max(5, left));
    }
    return 120; // défaut : 2 h
  });

  const action = isEdit
    ? updatePromotion.bind(null, promotion!.id)
    : createPromotion;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Promotion mise à jour" : "Promotion créée");
      router.push("/promotions");
    }
  }, [state, isEdit, router]);

  // Étape 1 (création uniquement) : choix du type.
  if (!type) {
    return (
      <div className="mx-auto max-w-2xl p-4 lg:p-6 lg:px-8">
        <Header isEdit={false} />
        <p className="text-muted mb-4 text-sm">Quel type de promotion ?</p>
        <div className="grid gap-3">
          {TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            const meta = PROMOTION_TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className="border-border bg-surface hover:border-primary-400 hover:bg-primary-50/40 flex items-center gap-4 rounded-[16px] border p-4 text-left transition-colors"
              >
                <span className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-[12px]">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{meta.label}</span>
                  <span className="text-muted block text-sm">
                    {meta.description}
                  </span>
                </span>
                <ArrowRight className="text-subtle size-4 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Étape 2 : formulaire adapté au type.
  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6 lg:px-8">
      <Header isEdit={isEdit} />

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="type" value={type} />

        {/* Type rappelé + changement (création seulement) */}
        <div className="border-border bg-surface flex items-center gap-3 rounded-[16px] border p-4">
          <TypeBadge type={type} />
          {!isEdit && (
            <button
              type="button"
              onClick={() => setType(null)}
              className="text-primary-700 ml-auto text-sm font-medium hover:underline"
            >
              Changer
            </button>
          )}
        </div>

        {/* Titre */}
        <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <div className="space-y-1.5">
            <Label>
              Titre affiché au client (FR)
              <span className="text-rose-600"> *</span>
            </Label>
            <Input
              name="title_fr"
              defaultValue={promotion?.title_fr ?? ""}
              placeholder="Ex. Soldes du week-end"
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Titre en arabe (اختياري)</Label>
            <Input
              name="title_ar"
              defaultValue={promotion?.title_ar ?? ""}
              placeholder="عنوان العرض"
              dir="rtl"
              disabled={pending}
            />
            <TranslateArButton
              sourceField="title_fr"
              targetField="title_ar"
              disabled={pending}
            />
          </div>
        </section>

        {/* Champs spécifiques au type */}
        {(PRODUCT_DISCOUNT_TYPES.includes(type) || type === "promo_code") && (
          <DiscountFields promotion={promotion} pending={pending} />
        )}

        {type === "flash_sale" && (
          <div className="border-danger-200 bg-danger-50 text-danger-800 flex items-start gap-2 rounded-[12px] border p-3 text-xs">
            <Timer className="mt-0.5 size-4 shrink-0" />
            <span>
              Vente flash : elle démarre <b>immédiatement</b> et dure{" "}
              <b>24 h maximum</b>. Choisissez la durée ci-dessous — le client
              voit un compte à rebours (heures : minutes : secondes) qui pousse
              à acheter vite.
            </span>
          </div>
        )}

        {type === "anti_gaspillage" && (
          <div className="border-success-200 bg-success-50 text-success-800 flex items-start gap-2 rounded-[12px] border p-3 text-xs">
            <Leaf className="mt-0.5 size-4 shrink-0" />
            <span>
              Anti-gaspillage : mettez vos invendus / surplus à prix cassé.
              Idéal en fin de journée pour écouler le stock plutôt que de jeter.
            </span>
          </div>
        )}

        {type === "promo_code" && (
          <PromoCodeFields promotion={promotion} pending={pending} />
        )}

        {type === "quantity_offer" && (
          <QuantityFields promotion={promotion} pending={pending} />
        )}

        {type === "free_gift" && (
          <GiftFields promotion={promotion} pending={pending} />
        )}

        {type === "free_delivery" && (
          <FreeDeliveryFields promotion={promotion} pending={pending} />
        )}

        {(PRODUCT_DISCOUNT_TYPES.includes(type) ||
          type === "quantity_offer") && (
          <ProductSelector
            products={products}
            initialSelected={
              promotion?.promotion_products?.map((pp) => pp.product_id) ?? []
            }
            pending={pending}
          />
        )}

        {/* Période — VENTE FLASH : durée (h/min, 24 h max) au lieu de dates ;
            la vente démarre MAINTENANT. Autres types : dates classiques. */}
        {type === "flash_sale" ? (
          <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
            <h2 className="text-base font-semibold">Durée de la vente flash</h2>
            <p className="text-muted -mt-2 text-xs">
              Démarre dès l&apos;enregistrement. 24 heures maximum.
            </p>
            {/* Préréglages 1-tap (marketing : durées courtes = urgence). */}
            <div className="flex flex-wrap gap-2">
              {[30, 60, 120, 180, 360, 720, 1440].map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={pending}
                  onClick={() => setFlashMinutes(m)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors",
                    flashMinutes === m
                      ? "border-danger-500 bg-danger-50 text-danger-700"
                      : "border-border bg-surface text-muted hover:border-danger-300"
                  )}
                >
                  {m < 60
                    ? `${m} min`
                    : m % 60 === 0
                      ? `${m / 60} h`
                      : `${Math.floor(m / 60)} h ${m % 60}`}
                </button>
              ))}
            </div>
            {/* Réglage fin heures / minutes. */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Heures</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={Math.floor(flashMinutes / 60)}
                  onChange={(e) => {
                    const h = Math.max(
                      0,
                      Math.min(24, Number(e.target.value) || 0)
                    );
                    setFlashMinutes(
                      Math.min(
                        24 * 60,
                        Math.max(5, h * 60 + (flashMinutes % 60))
                      )
                    );
                  }}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Minutes</Label>
                <Input
                  type="number"
                  min={0}
                  max={55}
                  step={5}
                  value={flashMinutes % 60}
                  onChange={(e) => {
                    const mn = Math.max(
                      0,
                      Math.min(59, Number(e.target.value) || 0)
                    );
                    setFlashMinutes(
                      Math.min(
                        24 * 60,
                        Math.max(5, Math.floor(flashMinutes / 60) * 60 + mn)
                      )
                    );
                  }}
                  disabled={pending}
                />
              </div>
            </div>
            <p className="text-danger-700 text-xs font-semibold">
              Fin de la vente : dans{" "}
              {Math.floor(flashMinutes / 60) > 0
                ? `${Math.floor(flashMinutes / 60)} h `
                : ""}
              {flashMinutes % 60 > 0 ? `${flashMinutes % 60} min` : ""}
            </p>
            {/* ends_at calculé = maintenant + durée (heure d'Alger). Recalculé à
                chaque rendu → frais à la soumission. Pas de starts_at : la
                vente démarre immédiatement. */}
            <input
              type="hidden"
              name="ends_at"
              value={toAlgiersInput(
                new Date(Date.now() + flashMinutes * 60000)
              )}
            />
          </section>
        ) : (
          <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
            <h2 className="text-base font-semibold">Période (optionnel)</h2>
            <p className="text-muted -mt-2 text-xs">
              Début pré-rempli sur maintenant (modifiable) · début futur =
              programmée automatiquement · fin vide = sans expiration.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Début</Label>
                <Input
                  type="datetime-local"
                  name="starts_at"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fin</Label>
                <Input
                  type="datetime-local"
                  name="ends_at"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  disabled={pending}
                />
              </div>
            </div>
          </section>
        )}

        {state.error && (
          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {state.error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="flex-1 sm:flex-none"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                {isEdit ? "Enregistrer" : "Créer la promotion"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <Link
            href="/promotions"
            className={cn(
              "text-muted hover:text-foreground inline-flex h-13 items-center px-4 text-sm font-medium",
              pending && "pointer-events-none opacity-50"
            )}
          >
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}

function Header({ isEdit }: { isEdit: boolean }) {
  return (
    <header className="mb-6">
      <Link
        href="/promotions"
        className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        Retour aux promotions
      </Link>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
        {isEdit ? "Modifier la promotion" : "Nouvelle promotion"}
      </h1>
    </header>
  );
}

function TypeBadge({ type }: { type: PromotionType }) {
  const Icon = TYPE_ICON[type];
  const meta = PROMOTION_TYPE_META[type];
  return (
    <>
      <span className="bg-primary-50 text-primary-700 flex size-9 shrink-0 items-center justify-center rounded-[10px]">
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-sm font-semibold">{meta.label}</p>
        <p className="text-muted text-xs">{meta.description}</p>
      </div>
    </>
  );
}

function DiscountFields({
  promotion,
  pending,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
}) {
  const [kind, setKind] = useState<DiscountKind>(
    promotion?.discount_kind ?? "percent"
  );
  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-base font-semibold">Réduction</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="bg-surface-3 grid grid-cols-2 gap-1 rounded-[12px] p-1">
            {(["percent", "amount"] as DiscountKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                disabled={pending}
                className={cn(
                  "rounded-[9px] px-3 py-2 text-sm font-medium transition-colors",
                  kind === k
                    ? "text-primary-700 bg-white shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {k === "percent" ? "Pourcentage" : "Montant (DA)"}
              </button>
            ))}
          </div>
          <input type="hidden" name="discount_kind" value={kind} />
        </div>
        <div className="space-y-1.5">
          <Label>
            Valeur<span className="text-rose-600"> *</span>
          </Label>
          <div className="relative">
            <Input
              type="number"
              name="discount_value"
              defaultValue={promotion?.discount_value ?? ""}
              min={1}
              max={kind === "percent" ? 100 : undefined}
              step={kind === "percent" ? 1 : 1}
              placeholder={kind === "percent" ? "10" : "200"}
              required
              disabled={pending}
              className="pr-12"
            />
            <span className="text-muted absolute top-1/2 right-4 -translate-y-1/2 text-sm font-medium">
              {kind === "percent" ? "%" : "DA"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PromoCodeFields({
  promotion,
  pending,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-base font-semibold">Code & limites</h2>
      <div className="space-y-1.5">
        <Label>
          Code<span className="text-rose-600"> *</span>
        </Label>
        <Input
          name="code"
          defaultValue={promotion?.code ?? ""}
          placeholder="WELCOME10"
          required
          disabled={pending}
          className="font-mono uppercase"
        />
        <p className="text-subtle text-xs">
          3 à 32 caractères : lettres, chiffres, - et _ (mis en majuscules).
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Utilisations max (total)</Label>
          <Input
            type="number"
            name="max_uses"
            defaultValue={promotion?.max_uses ?? ""}
            min={1}
            placeholder="Illimité"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Max par client</Label>
          <Input
            type="number"
            name="max_uses_per_customer"
            defaultValue={promotion?.max_uses_per_customer ?? ""}
            min={1}
            placeholder="Illimité"
            disabled={pending}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Panier minimum (DA)</Label>
        <div className="relative">
          <Input
            type="number"
            name="min_subtotal"
            defaultValue={promotion?.min_subtotal_da ?? ""}
            min={1}
            placeholder="Aucun"
            disabled={pending}
            className="pr-12"
          />
          <span className="text-muted absolute top-1/2 right-4 -translate-y-1/2 text-sm font-medium">
            DA
          </span>
        </div>
        <p className="text-subtle text-xs">
          Le code ne s&apos;applique qu&apos;au-dessus de ce montant
          d&apos;achats (ex. 3 000 DA). Vide = aucun minimum.
        </p>
      </div>
    </section>
  );
}

function QuantityFields({
  promotion,
  pending,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-base font-semibold">Offre quantité</h2>
      <p className="text-muted -mt-2 text-xs">
        « X achetés = Y offert(s) ». Ex. 2 achetés = 1 offert.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>
            Achetés<span className="text-rose-600"> *</span>
          </Label>
          <Input
            type="number"
            name="buy_qty"
            defaultValue={promotion?.buy_qty ?? ""}
            min={1}
            placeholder="2"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Offerts<span className="text-rose-600"> *</span>
          </Label>
          <Input
            type="number"
            name="get_qty"
            defaultValue={promotion?.get_qty ?? ""}
            min={1}
            placeholder="1"
            required
            disabled={pending}
          />
        </div>
      </div>
    </section>
  );
}

/** Champ « panier minimum » réutilisable (code / cadeau / livraison offerte). */
function MinSubtotalField({
  promotion,
  pending,
  hint,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
  hint: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Panier minimum (DA)</Label>
      <div className="relative">
        <Input
          type="number"
          name="min_subtotal"
          defaultValue={promotion?.min_subtotal_da ?? ""}
          min={1}
          placeholder="Aucun"
          disabled={pending}
          className="pr-12"
        />
        <span className="text-muted absolute top-1/2 right-4 -translate-y-1/2 text-sm font-medium">
          DA
        </span>
      </div>
      <p className="text-subtle text-xs">{hint}</p>
    </div>
  );
}

function GiftFields({
  promotion,
  pending,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-base font-semibold">Cadeau offert</h2>
      <div className="space-y-1.5">
        <Label>
          Le cadeau<span className="text-rose-600"> *</span>
        </Label>
        <Input
          name="gift_label"
          defaultValue={promotion?.gift_label ?? ""}
          placeholder="Ex. Un café offert, un porte-clé…"
          maxLength={120}
          required
          disabled={pending}
        />
        <p className="text-subtle text-xs">
          Décrivez ce que le client reçoit. Vous remettez le cadeau selon vos
          conditions (en boutique ou avec la commande).
        </p>
      </div>
      <MinSubtotalField
        promotion={promotion}
        pending={pending}
        hint="Cadeau offert au-dessus de ce montant d'achats (ex. 2 000 DA). Vide = sans condition."
      />
    </section>
  );
}

function FreeDeliveryFields({
  promotion,
  pending,
}: {
  promotion?: PromotionWithProducts;
  pending: boolean;
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-base font-semibold">Livraison offerte</h2>

      {/* Type de livraison concerné : TOURNÉE seule éligible (verrouillée). */}
      <div className="space-y-1.5">
        <Label>Type de livraison concerné</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="border-primary-500 bg-primary-50/60 flex items-center gap-2 rounded-[12px] border-2 px-3 py-2.5">
            <Truck className="text-primary-700 size-4 shrink-0" />
            <span className="text-primary-800 text-sm font-semibold">
              Tournée
            </span>
            <Check className="text-primary-600 ms-auto size-4 shrink-0" />
          </div>
          <div className="border-border bg-surface-3 flex items-center gap-2 rounded-[12px] border px-3 py-2.5 opacity-60">
            <Zap className="text-muted size-4 shrink-0" />
            <span className="text-muted text-sm font-medium line-through">
              Express
            </span>
          </div>
        </div>
        <p className="text-subtle text-xs">
          La livraison offerte s&apos;applique <b>uniquement à la tournée</b>
          (votre propre livraison, que vous assumez). L&apos;Express n&apos;est
          pas concerné : le livreur indépendant est payé par la plateforme.
        </p>
      </div>

      <MinSubtotalField
        promotion={promotion}
        pending={pending}
        hint="Livraison en tournée offerte au-dessus de ce montant d'achats (ex. 3 000 DA). Vide = sans condition."
      />
    </section>
  );
}

function ProductSelector({
  products,
  initialSelected,
  pending,
}: {
  products: ProductLite[];
  initialSelected: string[];
  pending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected)
  );
  const [query, setQuery] = useState("");

  // Liste filtrée par la recherche, AVEC les produits sélectionnés remontés en
  // tête (le commerçant voit d'abord ce qui est déjà dans la promo).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? products.filter((p) => p.name_fr.toLowerCase().includes(q))
      : products;
    return [...base].sort((a, b) => {
      const sa = selected.has(a.id) ? 0 : 1;
      const sb = selected.has(b.id) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.name_fr.localeCompare(b.name_fr);
    });
  }, [products, query, selected]);

  // Récap des produits sélectionnés (ordre du catalogue) pour le bloc du bas.
  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function remove(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <section className="border-border bg-surface space-y-3 rounded-[16px] border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Produits concernés<span className="text-rose-600"> *</span>
        </h2>
        <span className="text-muted text-xs tabular-nums">
          {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
        </span>
      </div>

      {/* Champs cachés postés au serveur */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="product_ids" value={id} />
      ))}

      {products.length === 0 ? (
        <p className="text-muted text-sm">
          Vous n&apos;avez aucun produit. Ajoutez-en au catalogue d&apos;abord.
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un produit…"
              className="pl-9"
              disabled={pending}
            />
          </div>
          <ul className="border-border divide-border max-h-64 divide-y overflow-y-auto rounded-[12px] border">
            {filtered.map((p) => {
              const checked = selected.has(p.id);
              return (
                <li key={p.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors",
                      checked ? "bg-primary-50/60" : "hover:bg-surface-2"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      disabled={pending}
                      className="accent-primary-600 size-4"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.name_fr}
                    </span>
                    <span className="text-muted tabular-nums">
                      {formatDA(p.price_da)}
                    </span>
                  </label>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="text-muted px-3 py-4 text-center text-sm">
                Aucun produit ne correspond.
              </li>
            )}
          </ul>

          {/* Récap des produits sélectionnés : retrait rapide en cas d'erreur. */}
          {selectedProducts.length > 0 && (
            <div className="border-primary-100 bg-primary-50/40 space-y-2 rounded-[12px] border p-3">
              <p className="text-primary-800 text-xs font-semibold">
                Produits sélectionnés ({selectedProducts.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedProducts.map((p) => (
                  <span
                    key={p.id}
                    className="border-primary-200 bg-surface inline-flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3 text-xs font-medium"
                  >
                    <span className="max-w-[180px] truncate">{p.name_fr}</span>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={pending}
                      aria-label={`Retirer ${p.name_fr}`}
                      className="text-muted grid size-5 place-items-center rounded-full transition-colors hover:bg-rose-100 hover:text-rose-700"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
