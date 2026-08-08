"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  GripVertical,
  CheckSquare,
  Square,
  ImageOff,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  Loader2,
  ImagePlus,
  X,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { createClient } from "@/lib/supabase/client";
import { Portal } from "@/components/ui/portal";
import {
  setCategoryImage,
  renameCategory,
  deleteCategories,
} from "@/app/(merchant)/catalog/categories/actions";
import type { DragHandle } from "./catalog-shared";

export function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary-600 bg-primary-600 text-white"
          : "border-border-strong text-muted hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}

export function SortableCategory({
  id,
  sortable,
  children,
}: {
  id: string;
  sortable: boolean;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children(sortable ? { attributes, listeners } : null)}
    </div>
  );
}

/** Actions d'édition d'une catégorie (renommer / photo / supprimer), regroupées
 *  derrière UN seul bouton « Modifier » → feuille dédiée `CategoryEditSheet`. */
export type CategoryEdit = {
  categoryId: string;
  merchantId: string;
  onRenamed: (title: string) => void;
  onImageChanged: (url: string | null) => void;
  onDeleted: () => void;
};

export function CategorySection({
  title,
  image,
  count,
  open,
  onToggle,
  addHref,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  dragHandle,
  edit,
  children,
}: {
  title: string;
  image: string | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  addHref: string;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  dragHandle: DragHandle;
  /** Édition consolidée (null pour « sans catégorie » ou en sélection multiple). */
  edit: CategoryEdit | null;
  children: React.ReactNode;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <section
      className={cn(
        "border-border bg-surface overflow-hidden rounded-lg border",
        selected && "ring-primary-500 ring-2"
      )}
    >
      <div className="hover:bg-surface-2 flex items-center gap-2 px-3 py-2.5 transition-colors">
        {dragHandle && (
          <button
            type="button"
            className="text-subtle hover:text-foreground -ml-1 cursor-grab touch-none active:cursor-grabbing"
            aria-label="Déplacer la catégorie"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}

        {selectMode && selectable && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selected}
            className="inline-flex items-center"
          >
            {selected ? (
              <CheckSquare className="text-primary-600 size-5" />
            ) : (
              <Square className="text-muted size-5" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="bg-surface-3 relative size-9 shrink-0 overflow-hidden rounded-sm">
            {image ? (
              <Image
                src={image}
                alt={title}
                fill
                sizes="36px"
                className="object-cover"
              />
            ) : (
              <span className="text-subtle flex h-full items-center justify-center">
                <ImageOff className="size-4" />
              </span>
            )}
          </div>
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="bg-surface-3 text-muted text-caption rounded-full px-2 py-0.5 font-medium tabular-nums">
            {count}
          </span>
        </button>

        <Link
          href={addHref}
          title="Ajouter un produit à cette catégorie"
          className="border-border-strong text-primary-700 hover:bg-primary-50 rounded-control inline-flex h-9 items-center gap-1 border px-2.5 text-xs font-medium"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Produit</span>
        </Link>
        {/* Un SEUL bouton « Modifier » (renommer + photo + supprimer) → moins de
            boutons sur l'en-tête ; le reste se fait dans la feuille dédiée. */}
        {edit && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            title="Modifier la catégorie"
            aria-label="Modifier la catégorie"
            className="text-muted hover:bg-surface-3 hover:text-foreground rounded-control inline-flex size-9 items-center justify-center"
          >
            <Pencil className="size-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Replier" : "Déplier"}
          className="text-muted hover:bg-surface-3 rounded-control ml-0.5 inline-flex size-9 items-center justify-center"
        >
          <ChevronDown
            className={cn("size-5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && <div className="px-4 pt-1 pb-4">{children}</div>}

      {edit && editOpen && (
        <CategoryEditSheet
          title={title}
          image={image}
          count={count}
          categoryId={edit.categoryId}
          merchantId={edit.merchantId}
          onRenamed={edit.onRenamed}
          onImageChanged={edit.onImageChanged}
          onDeleted={edit.onDeleted}
          onClose={() => setEditOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * Feuille d'édition d'une catégorie (Bolt-style) : ouverte par le SEUL bouton
 * « Modifier » de l'en-tête. Regroupe renommer + photo (ajouter/changer/retirer)
 * + supprimer → l'en-tête de catégorie n'a plus qu'un bouton au lieu de trois.
 * Autonome : appelle les actions et remonte la synchro locale via les callbacks.
 */
function CategoryEditSheet({
  title,
  image,
  count,
  categoryId,
  merchantId,
  onRenamed,
  onImageChanged,
  onDeleted,
  onClose,
}: {
  title: string;
  image: string | null;
  count: number;
  categoryId: string;
  merchantId: string;
  onRenamed: (title: string) => void;
  onImageChanged: (url: string | null) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(title);
  const [img, setImg] = useState(image);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();
  const fileRef = useRef<HTMLInputElement>(null);

  function saveName() {
    const clean = name.trim();
    if (!clean || clean === title) return;
    startTransition(async () => {
      const res = await renameCategory(categoryId, clean);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      onRenamed(clean);
      setNote({ ok: true, text: "Nom mis à jour" });
    });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setNote({ ok: false, text: "Le fichier doit être une image." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNote({ ok: false, text: "Image trop lourde (max 5 Mo)." });
      return;
    }
    if (!merchantId) {
      setNote({ ok: false, text: "Session invalide, rechargez la page." });
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${merchantId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("products")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setNote({ ok: false, text: `Échec de l'upload : ${upErr.message}` });
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("products").getPublicUrl(path);
      const res = await setCategoryImage(categoryId, publicUrl);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      setImg(publicUrl);
      onImageChanged(publicUrl);
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    setBusy(true);
    try {
      const res = await setCategoryImage(categoryId, null);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      setImg(null);
      onImageChanged(null);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteCategory() {
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
        setNote({ ok: false, text: res.error });
        return;
      }
      onDeleted();
      onClose();
    });
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        onClick={onClose}
      >
        <div
          className="bg-surface w-full max-w-md rounded-t-xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Modifier la catégorie</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="text-muted hover:bg-surface-3 hover:text-foreground inline-flex size-8 items-center justify-center rounded-full"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Nom */}
          <label className="text-muted mb-1.5 block text-xs font-medium">
            Nom de la catégorie
          </label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
              }}
              placeholder="Nom"
            />
            <Button
              type="button"
              onClick={saveName}
              disabled={pending || !name.trim() || name.trim() === title}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Enregistrer"
              )}
            </Button>
          </div>

          {/* Photo */}
          <p className="text-muted mt-5 mb-1.5 text-xs font-medium">
            Photo de la catégorie
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3">
            <div className="bg-surface-3 relative size-16 shrink-0 overflow-hidden rounded-md">
              {img ? (
                <Image
                  src={img}
                  alt={title}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <span className="text-subtle flex h-full items-center justify-center">
                  <ImageOff className="size-5" />
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {img ? "Changer" : "Ajouter"}
              </Button>
              {img && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  className="text-danger-600 hover:bg-danger-50 rounded-control inline-flex h-9 items-center gap-1.5 px-3 text-sm font-medium disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                  Retirer
                </button>
              )}
            </div>
          </div>

          {/* Danger : supprimer la catégorie */}
          <div className="border-border mt-5 border-t pt-4">
            <button
              type="button"
              onClick={onDeleteCategory}
              disabled={pending}
              className="text-danger-600 hover:bg-danger-50 border-danger-200 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-semibold disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              Supprimer la catégorie
            </button>
            <p className="text-muted mt-1.5 text-center text-xs">
              {count > 0
                ? `Les ${count} produit${count > 1 ? "s" : ""} lié${count > 1 ? "s" : ""} deviendront « sans catégorie ».`
                : "Cette catégorie est vide."}
            </p>
          </div>

          <ActionNote note={note} className="mt-2" />
        </div>
      </div>
    </Portal>
  );
}
