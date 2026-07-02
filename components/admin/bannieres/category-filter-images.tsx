"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { MERCHANT_CATEGORIES } from "@/lib/config/categories";
import {
  deleteCategoryFilterImage,
  upsertCategoryFilterImage,
} from "@/app/admin/bannieres/filter-images-actions";

/**
 * ADMIN (Marketing) — images des RONDS DE FILTRE catégories du marketplace :
 * une ligne par type de commerçant, upload/remplacement/suppression. Le strip
 * client applique l'image automatiquement (repli emoji si absente).
 */
export function CategoryFilterImages({
  images,
}: {
  /** code → image_url (état actuel, lu côté serveur). */
  images: Record<string, string>;
}) {
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const onPick = (code: string, file: File | null) => {
    if (!file) return;
    setBusyCode(code);
    setErrs((e) => ({ ...e, [code]: "" }));
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await upsertCategoryFilterImage(code, fd);
      if (r.error) setErrs((e) => ({ ...e, [code]: r.error! }));
      setBusyCode(null);
      router.refresh();
    });
  };

  const onDelete = (code: string) => {
    setBusyCode(code);
    start(async () => {
      const r = await deleteCategoryFilterImage(code);
      if (r.error) setErrs((e) => ({ ...e, [code]: r.error! }));
      setBusyCode(null);
      router.refresh();
    });
  };

  return (
    <section className="border-border bg-surface mt-8 rounded-[16px] border p-4">
      <h2 className="text-sm font-bold">Images des filtres catégories</h2>
      <p className="text-muted mt-0.5 mb-3 text-xs">
        Le rond de filtre du marketplace affiche l&apos;image (pleine, recadrée)
        à la place de l&apos;emoji. PNG/WebP carré conseillé, max 2 Mo.
      </p>
      <ul className="divide-border divide-y">
        {MERCHANT_CATEGORIES.map((c) => {
          const url = images[c.code];
          const busy = busyCode === c.code;
          return (
            <li key={c.code} className="flex items-center gap-3 py-2.5">
              <span className="bg-surface-2 grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border text-xl">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span aria-hidden>{c.emoji}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {c.label}
                </span>
                <span className="text-subtle text-xs">
                  {url ? "Image active" : "Emoji (aucune image)"}
                </span>
                {errs[c.code] ? (
                  <span className="text-danger-600 block text-xs font-semibold">
                    {errs[c.code]}
                  </span>
                ) : null}
              </span>
              <input
                ref={(el) => {
                  inputs.current[c.code] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPick(c.code, e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => inputs.current[c.code]?.click()}
                className="border-border bg-surface-2 hover:bg-surface-3 inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {url ? "Remplacer" : "Ajouter"}
              </button>
              {url && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(c.code)}
                  aria-label={`Supprimer l'image ${c.label}`}
                  className="text-danger-600 hover:bg-danger-50 shrink-0 rounded-[10px] p-2 disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
