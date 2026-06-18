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
import { useConfirm } from "@/components/ui/confirm";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";
import {
  createCategory,
  updateCategory,
  deleteCategories,
  type CategoryFormState,
} from "@/app/(merchant)/catalog/categories/actions";

const initialState: CategoryFormState = {};

export function CategoryForm({
  merchantId,
  category,
}: {
  merchantId: string;
  category?: Category;
}) {
  const isEdit = !!category;
  const router = useRouter();
  const action = isEdit
    ? updateCategory.bind(null, category!.id)
    : createCategory;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Catégorie mise à jour" : "Catégorie créée");
      router.push("/catalog/categories");
    }
  }, [state, isEdit, router]);

  const [imageUrl, setImageUrl] = useState<string | null>(
    category?.image_url ?? null
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
      const path = `${merchantId}/categories/${crypto.randomUUID()}.${ext}`;
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
      <header className="mb-6">
        <Link
          href="/catalog/categories"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour aux catégories
        </Link>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          {isEdit ? "Modifier la catégorie" : "Nouvelle catégorie"}
        </h1>
      </header>

      <form action={formAction} className="space-y-6">
        {/* Image */}
        <section className="border-border bg-surface rounded-[16px] border p-5">
          <Label className="mb-2 block">Photo de la catégorie</Label>
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
              <div className="bg-surface-3 relative h-28 w-44 overflow-hidden rounded-[12px]">
                <Image
                  src={imageUrl}
                  alt="Aperçu"
                  fill
                  sizes="176px"
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
              className="border-border-strong text-muted hover:bg-surface-2 flex h-28 w-44 flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed text-xs disabled:opacity-50"
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

        {/* Titre + description */}
        <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <div className="space-y-1.5">
            <Label>
              Titre<span className="text-rose-600"> *</span>
            </Label>
            <Input
              name="title"
              defaultValue={category?.title ?? ""}
              placeholder="Pains, Viennoiseries…"
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <textarea
              name="description"
              defaultValue={category?.description ?? ""}
              placeholder="Courte description affichée aux clients (optionnel)."
              rows={3}
              disabled={pending}
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            />
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
                {isEdit ? "Enregistrer" : "Créer la catégorie"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <Link
            href="/catalog/categories"
            className={cn(
              "text-muted hover:text-foreground inline-flex h-13 items-center px-4 text-sm font-medium",
              pending && "pointer-events-none opacity-50"
            )}
          >
            Annuler
          </Link>
        </div>
      </form>

      {isEdit && <DeleteCategory categoryId={category!.id} />}
    </div>
  );
}

function DeleteCategory({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  async function onDelete() {
    if (
      !(await confirm({
        title: "Supprimer cette catégorie ?",
        message: "Les produits liés deviendront « sans catégorie ».",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteCategories([categoryId]);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Catégorie supprimée");
      router.push("/catalog/categories");
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
        Supprimer cette catégorie
      </button>
    </div>
  );
}
