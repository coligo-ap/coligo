"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Gift,
  Loader2,
  Search,
  Ticket,
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
import {
  createPromotion,
  updatePromotion,
  type PromotionFormState,
} from "@/app/(merchant)/promotions/actions";

const initialState: PromotionFormState = {};

const TYPE_ICON: Record<PromotionType, typeof BadgePercent> = {
  product_discount: BadgePercent,
  promo_code: Ticket,
  quantity_offer: Gift,
};

const TYPES: PromotionType[] = [
  "product_discount",
  "promo_code",
  "quantity_offer",
];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
          </div>
        </section>

        {/* Champs spécifiques au type */}
        {(type === "product_discount" || type === "promo_code") && (
          <DiscountFields promotion={promotion} pending={pending} />
        )}

        {type === "promo_code" && (
          <PromoCodeFields promotion={promotion} pending={pending} />
        )}

        {type === "quantity_offer" && (
          <QuantityFields promotion={promotion} pending={pending} />
        )}

        {(type === "product_discount" || type === "quantity_offer") && (
          <ProductSelector
            products={products}
            initialSelected={
              promotion?.promotion_products?.map((pp) => pp.product_id) ?? []
            }
            pending={pending}
          />
        )}

        {/* Période */}
        <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <h2 className="text-base font-semibold">Période (optionnel)</h2>
          <p className="text-muted -mt-2 text-xs">
            Laissez vide pour une promotion permanente. Une date de début future
            programme la promo automatiquement.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Début</Label>
              <Input
                type="datetime-local"
                name="starts_at"
                defaultValue={toLocalInput(promotion?.starts_at ?? null)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fin</Label>
              <Input
                type="datetime-local"
                name="ends_at"
                defaultValue={toLocalInput(promotion?.ends_at ?? null)}
                disabled={pending}
              />
            </div>
          </div>
        </section>

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name_fr.toLowerCase().includes(q));
  }, [products, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        </>
      )}
    </section>
  );
}
