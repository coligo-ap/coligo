"use client";

import { useRef, useState } from "react";
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
  ImageIcon,
  ImagePlus,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { createClient } from "@/lib/supabase/client";
import { Portal } from "@/components/ui/portal";
import { setCategoryImage } from "@/app/(merchant)/catalog/categories/actions";
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

export function CategorySection({
  title,
  image,
  count,
  open,
  onToggle,
  onRename,
  photoAction,
  addHref,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  onDelete,
  dragHandle,
  children,
}: {
  title: string;
  image: string | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  onRename: (() => void) | null;
  photoAction?: React.ReactNode;
  addHref: string;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: (() => void) | null;
  dragHandle: DragHandle;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface overflow-hidden rounded-[16px] border",
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
          <div className="bg-surface-3 relative size-9 shrink-0 overflow-hidden rounded-[8px]">
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
          <span className="bg-surface-3 text-muted rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums">
            {count}
          </span>
        </button>

        <Link
          href={addHref}
          title="Ajouter un produit à cette catégorie"
          className="border-border-strong text-primary-700 hover:bg-primary-50 inline-flex h-9 items-center gap-1 rounded-[10px] border px-2.5 text-xs font-medium"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Produit</span>
        </Link>
        {photoAction}
        {onRename && (
          <button
            type="button"
            onClick={onRename}
            title="Renommer la catégorie"
            className="text-muted hover:bg-surface-3 hover:text-foreground inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Pencil className="size-4" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Supprimer la catégorie"
            className="text-muted hover:bg-danger-50 hover:text-danger-600 inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Trash2 className="size-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Replier" : "Déplier"}
          className="text-muted hover:bg-surface-3 ml-0.5 inline-flex size-9 items-center justify-center rounded-[10px]"
        >
          <ChevronDown
            className={cn("size-5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && <div className="px-4 pt-1 pb-4">{children}</div>}
    </section>
  );
}

/**
 * Photo d'une catégorie : ajouter (pas d'image → sélecteur direct), remplacer
 * ou retirer (image existante → petit menu). Upload côté client dans le bucket
 * `products` (même chemin que les produits), URL figée par `setCategoryImage`.
 */
export function CategoryPhotoButton({
  categoryId,
  merchantId,
  image,
  onChanged,
}: {
  categoryId: string;
  merchantId: string;
  image: string | null;
  onChanged: (url: string | null) => void;
}) {
  const confirm = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useActionNote();
  const fileRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Aligné au bord droit du bouton, juste dessous (192px = w-48).
    setMenuPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.right - 192, window.innerWidth - 200)),
    });
    setMenuOpen(true);
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
      // Succès : la nouvelle photo s'affiche (onChanged) = feedback visuel.
      onChanged(publicUrl);
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    setMenuOpen(false);
    if (
      !(await confirm({
        title: "Retirer la photo de la catégorie ?",
        message: "La catégorie s'affichera sans visuel côté client.",
        confirmLabel: "Retirer",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await setCategoryImage(categoryId, null);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Succès : la photo disparaît (onChanged) = feedback visuel.
      onChanged(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
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
      <button
        ref={btnRef}
        type="button"
        disabled={busy}
        onClick={() => {
          if (!image) fileRef.current?.click();
          else if (menuOpen) setMenuOpen(false);
          else openMenu();
        }}
        title={image ? "Photo de la catégorie" : "Ajouter une photo"}
        aria-label={image ? "Photo de la catégorie" : "Ajouter une photo"}
        className="text-muted hover:bg-surface-3 hover:text-foreground inline-flex size-9 items-center justify-center rounded-[10px] disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : image ? (
          <ImageIcon className="size-4" />
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>

      {note && (
        <div className="border-border bg-surface absolute top-full right-0 z-30 mt-1 w-max max-w-[220px] rounded-[8px] border px-2 py-1 shadow-lg">
          <ActionNote note={note} />
        </div>
      )}

      {/* Menu portalisé vers le body : la section catégorie est en
          `overflow-hidden` (coins arrondis) et clippait un menu absolu,
          surtout catégorie repliée. Position calculée depuis le bouton. */}
      {menuOpen && menuPos && (
        <Portal>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="border-border bg-surface fixed z-50 w-48 overflow-hidden rounded-[12px] border p-1 shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
              className="hover:bg-surface-2 flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm"
            >
              <ImagePlus className="size-4" />
              Remplacer la photo
            </button>
            <button
              type="button"
              onClick={removeImage}
              className="text-danger-600 hover:bg-danger-50 flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm"
            >
              <Trash2 className="size-4" />
              Retirer la photo
            </button>
          </div>
        </Portal>
      )}
    </div>
  );
}
