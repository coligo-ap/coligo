"use client";

import Link from "next/link";
import Image from "next/image";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { useConfirm } from "@/components/ui/confirm";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Trash2,
  X,
  ArrowRight,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  PRODUCT_UNIT_META,
  type Category,
  type Product,
  type ProductUnit,
} from "@/lib/types";
import {
  createProduct,
  updateProduct,
  deleteProducts,
  type ProductFormState,
} from "@/app/(merchant)/catalog/actions";
import { quickCreateCategory } from "@/app/(merchant)/catalog/categories/actions";
import { TranslateArButton } from "@/components/merchant/translate-ar-button";

const SELECT_CLASS =
  "appearance-none flex h-12 w-full rounded-[12px] border border-border-strong bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50";

const initialState: ProductFormState = {};

const UNIT_OPTIONS = Object.entries(PRODUCT_UNIT_META) as [
  ProductUnit,
  { label: string; short: string },
][];

export function ProductForm({
  merchantId,
  product,
  categories,
  initialCategoryId,
}: {
  merchantId: string;
  product?: Product;
  categories: Category[];
  initialCategoryId?: string;
}) {
  const isEdit = !!product;

  const router = useRouter();
  const action = isEdit ? updateProduct.bind(null, product!.id) : createProduct;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    // Succès : navigation vers le catalogue (le produit y apparaît = feedback
    // visuel) ; l'erreur est affichée inline sous le formulaire. Pas de toast.
    if (state.ok) router.push("/catalog");
  }, [state, router]);

  // Liste locale de catégories (permet l'ajout « à la volée »).
  const [cats, setCats] = useState<{ id: string; title: string }[]>(
    categories.map((c) => ({ id: c.id, title: c.title }))
  );
  const [categoryId, setCategoryId] = useState<string>(
    product?.category_id ?? initialCategoryId ?? ""
  );

  const [imageUrl, setImageUrl] = useState<string | null>(
    product?.image_url ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    if (!file.type.startsWith("image/")) {
      setUploadError("Le fichier doit être une image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image trop lourde (max 5 Mo).");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${merchantId}/${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage
        .from("products")
        .upload(path, file, { upsert: false, contentType: file.type });

      if (error) {
        setUploadError(`Échec de l'upload : ${error.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("products").getPublicUrl(path);
      setImageUrl(publicUrl);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6 lg:px-8">
      {/* Header */}
      <header className="mb-6">
        <Link
          href="/catalog"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour au catalogue
        </Link>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          {isEdit ? "Modifier le produit" : "Nouveau produit"}
        </h1>
      </header>

      <form action={formAction} className="space-y-6">
        {/* Image */}
        <section className="border-border bg-surface rounded-[16px] border p-5">
          <Label className="mb-2 block">Photo du produit</Label>
          <input type="hidden" name="image_url" value={imageUrl ?? ""} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />

          {imageUrl ? (
            <div className="relative inline-block">
              <div className="bg-surface-3 relative size-36 overflow-hidden rounded-[12px]">
                <Image
                  src={imageUrl}
                  alt="Aperçu"
                  fill
                  sizes="144px"
                  className="object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="bg-foreground/80 absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full text-white"
                aria-label="Retirer l'image"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-border-strong text-muted hover:bg-surface-2 flex size-36 flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed text-xs disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <ImagePlus className="size-6" />
              )}
              {uploading ? "Envoi…" : "Ajouter une photo"}
            </button>
          )}
          {uploadError && (
            <p className="text-danger-600 mt-2 text-xs">{uploadError}</p>
          )}
        </section>

        {/* Nom bilingue */}
        <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom (français)" required>
              <Input
                name="name_fr"
                defaultValue={product?.name_fr ?? ""}
                placeholder="Baguette traditionnelle"
                required
                disabled={pending}
              />
            </Field>
            <Field label="الاسم (العربية)">
              <div className="space-y-1.5">
                <Input
                  name="name_ar"
                  defaultValue={product?.name_ar ?? ""}
                  placeholder="بغيت تقليدي"
                  dir="rtl"
                  disabled={pending}
                />
                <TranslateArButton
                  sourceField="name_fr"
                  targetField="name_ar"
                  disabled={pending}
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Description (français)">
              <textarea
                name="description_fr"
                defaultValue={product?.description_fr ?? ""}
                placeholder="Détails, ingrédients…"
                rows={3}
                disabled={pending}
                className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
              />
            </Field>
            <Field label="الوصف (العربية)">
              <div className="space-y-1.5">
                <textarea
                  name="description_ar"
                  defaultValue={product?.description_ar ?? ""}
                  rows={3}
                  dir="rtl"
                  disabled={pending}
                  className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                />
                <TranslateArButton
                  sourceField="description_fr"
                  targetField="description_ar"
                  disabled={pending}
                />
              </div>
            </Field>
          </div>
        </section>

        {/* Prix / unité / catégorie */}
        <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prix (DA)" required>
              <Input
                name="price_da"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={product?.price_da ?? ""}
                placeholder="120"
                required
                disabled={pending}
              />
            </Field>
            <Field label="Unité de vente" required>
              <select
                name="unit"
                defaultValue={product?.unit ?? "piece"}
                disabled={pending}
                className={SELECT_CLASS}
              >
                {UNIT_OPTIONS.map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <input type="hidden" name="category_id" value={categoryId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Catégorie">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="">Aucune catégorie</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <QuickCategory
                disabled={pending}
                onCreated={(c) => {
                  setCats((prev) => [...prev, c]);
                  setCategoryId(c.id);
                }}
              />
            </Field>

            <Field label="Stock">
              <Input
                name="stock_qty"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={product?.stock_qty ?? ""}
                placeholder="Laisser vide = non suivi"
                disabled={pending}
              />
              <p className="text-subtle text-xs">0 = épuisé</p>
            </Field>
          </div>

          {/* Quantités imposées au client (dans l'unité de vente). */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantité minimum (par commande)">
              <Input
                name="min_qty"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                defaultValue={product?.min_qty ?? ""}
                placeholder="Laisser vide = libre"
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Dans l&apos;unité de vente — ex. 0,5 = minimum 500 g pour un
                produit au kilo.
              </p>
            </Field>
            <Field label="Quantité maximum (par commande)">
              <Input
                name="max_qty"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                defaultValue={product?.max_qty ?? ""}
                placeholder="Laisser vide = libre"
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Plafond toutes lignes confondues sur une même commande.
              </p>
            </Field>
          </div>

          <label className="flex items-center gap-3 pt-1">
            <input
              type="checkbox"
              name="is_available"
              defaultChecked={product?.is_available ?? true}
              disabled={pending}
              className="accent-primary-600 size-4"
            />
            <span className="text-sm font-medium">
              Disponible à la vente
              <span className="text-muted block text-xs font-normal">
                Décochez pour masquer ce produit sans le supprimer.
              </span>
            </span>
          </label>
        </section>

        {state.error && (
          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {state.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={pending || uploading}
            className="flex-1 sm:flex-none"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                {isEdit ? "Enregistrer" : "Créer le produit"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <Link
            href="/catalog"
            className={cn(
              "text-muted hover:text-foreground inline-flex h-13 items-center px-4 text-sm font-medium",
              pending && "pointer-events-none opacity-50"
            )}
          >
            Annuler
          </Link>
        </div>
      </form>

      {isEdit && <DeleteProduct productId={product!.id} />}
    </div>
  );
}

function DeleteProduct({ productId }: { productId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();

  async function onDelete() {
    if (
      !(await confirm({
        title: "Supprimer ce produit ?",
        message:
          "Le produit sera retiré de votre catalogue. Vos ventes passées restent intactes.",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteProducts([productId]);
      if (res?.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Succès : navigation vers le catalogue (produit disparu = feedback visuel).
      // Invalide le cache catalogue (TanStack) → la liste se met à jour SANS
      // attendre un refetch hasardeux ; sinon le produit semblait « rester ».
      queryClient.invalidateQueries({ queryKey: ["merchant-catalog"] });
      router.push("/catalog");
      router.refresh();
    });
  }

  return (
    <div className="border-border mt-8 border-t pt-6">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-danger-600 hover:bg-danger-50 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
        Supprimer ce produit
      </button>
      <ActionNote note={note} className="mt-1.5" />
    </div>
  );
}

function QuickCategory({
  disabled,
  onCreated,
}: {
  disabled?: boolean;
  onCreated: (cat: { id: string; title: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    const clean = title.trim();
    if (!clean) return;
    setError(null);
    startTransition(async () => {
      const res = await quickCreateCategory(clean);
      if (res.error || !res.id) {
        setError(res.error ?? "Échec.");
        return;
      }
      // Succès : la catégorie est ajoutée à la liste (onCreated) et le mini-form
      // se ferme = feedback visuel ; l'erreur est déjà inline. Pas de toast.
      onCreated({ id: res.id, title: res.title! });
      setTitle("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-primary-700 hover:text-primary-800 inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        Nouvelle catégorie
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            create();
          }
        }}
        placeholder="Nom de la catégorie"
        autoFocus
        disabled={pending}
        className="h-10"
      />
      <Button
        type="button"
        size="sm"
        onClick={create}
        disabled={pending || !title.trim()}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTitle("");
          setError(null);
        }}
        disabled={pending}
        className="text-muted hover:text-foreground text-xs"
      >
        Annuler
      </button>
      {error && <span className="text-danger-600 text-xs">{error}</span>}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      {children}
    </div>
  );
}
