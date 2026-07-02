"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  createCategory,
  deleteCategory,
  deleteCategoryFilterImage,
  setCategoryStatus,
  upsertCategoryFilterImage,
} from "@/app/admin/bannieres/filter-images-actions";

/**
 * ADMIN (Marketing) — GESTION DES CATÉGORIES / FILTRES du marketplace
 * (mig 0311) : statut (actif / masqué / bientôt disponible — appliqué à
 * l'inscription commerçant ET au strip de filtres), image du rond, création
 * de nouvelles catégories, suppression (refusée si des commerçants
 * l'utilisent). Erreurs INLINE par ligne.
 */

export type AdminCategory = {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  imageUrl: string | null;
  status: "active" | "hidden" | "coming_soon";
  merchants: number;
};

const STATUS_LABEL: Record<AdminCategory["status"], string> = {
  active: "Actif",
  hidden: "Masqué",
  coming_soon: "Bientôt disponible",
};

export function CategoryFilterImages({
  categories,
}: {
  categories: AdminCategory[];
}) {
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Création
  const [showCreate, setShowCreate] = useState(false);
  const [nCode, setNCode] = useState("");
  const [nLabel, setNLabel] = useState("");
  const [nLabelAr, setNLabelAr] = useState("");
  const [nEmoji, setNEmoji] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);

  const run = (code: string, fn: () => Promise<{ error?: string }>) => {
    setBusyCode(code);
    setErrs((e) => ({ ...e, [code]: "" }));
    start(async () => {
      const r = await fn();
      if (r.error) setErrs((e) => ({ ...e, [code]: r.error! }));
      setBusyCode(null);
      router.refresh();
    });
  };

  return (
    <section className="border-border bg-surface mt-8 rounded-[16px] border p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Catégories &amp; filtres</h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="bg-primary-600 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-bold text-white"
        >
          <Plus className="size-3.5" /> Nouvelle catégorie
        </button>
      </div>
      <p className="text-muted mb-3 text-xs">
        Statut appliqué à l&apos;inscription commerçant ET au filtre
        marketplace. Image : PNG/WebP carré, max 2 Mo — sinon l&apos;emoji.
      </p>

      {showCreate && (
        <div className="border-border bg-surface-2 mb-3 space-y-2 rounded-[12px] border p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={nCode}
              onChange={(e) => setNCode(e.target.value)}
              placeholder="code_technique (ex. tacos)"
              className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
            />
            <input
              value={nEmoji}
              onChange={(e) => setNEmoji(e.target.value)}
              placeholder="Emoji (ex. 🌮)"
              className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
            />
            <input
              value={nLabel}
              onChange={(e) => setNLabel(e.target.value)}
              placeholder="Libellé FR"
              className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
            />
            <input
              value={nLabelAr}
              onChange={(e) => setNLabelAr(e.target.value)}
              placeholder="Libellé AR"
              dir="rtl"
              className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
            />
          </div>
          {createErr && (
            <p className="text-danger-600 text-xs font-semibold">{createErr}</p>
          )}
          <button
            type="button"
            disabled={busyCode === "__create"}
            onClick={() => {
              setBusyCode("__create");
              setCreateErr(null);
              start(async () => {
                const r = await createCategory({
                  code: nCode,
                  label: nLabel,
                  labelAr: nLabelAr,
                  emoji: nEmoji,
                });
                if (r.error) setCreateErr(r.error);
                else {
                  setShowCreate(false);
                  setNCode("");
                  setNLabel("");
                  setNLabelAr("");
                  setNEmoji("");
                }
                setBusyCode(null);
                router.refresh();
              });
            }}
            className="bg-primary-600 rounded-[10px] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busyCode === "__create" ? "Création…" : "Créer"}
          </button>
        </div>
      )}

      <ul className="divide-border divide-y">
        {categories.map((c) => {
          const busy = busyCode === c.code;
          return (
            <li
              key={c.code}
              className="flex flex-wrap items-center gap-3 py-2.5"
            >
              <span className="bg-surface-2 grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border text-xl">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
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
                  {c.code} · {c.merchants} commerçant
                  {c.merchants > 1 ? "s" : ""}
                  {c.imageUrl ? " · image active" : ""}
                </span>
                {errs[c.code] ? (
                  <span className="text-danger-600 block text-xs font-semibold">
                    {errs[c.code]}
                  </span>
                ) : null}
              </span>

              {/* Statut */}
              <select
                value={c.status}
                disabled={busy}
                onChange={(e) =>
                  run(c.code, () =>
                    setCategoryStatus(
                      c.code,
                      e.target.value as AdminCategory["status"]
                    )
                  )
                }
                className="border-border-strong bg-surface h-9 shrink-0 rounded-[10px] border px-2 text-xs font-semibold"
                aria-label={`Statut ${c.label}`}
              >
                {(Object.keys(STATUS_LABEL) as AdminCategory["status"][]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  )
                )}
              </select>

              {/* Image */}
              <input
                ref={(el) => {
                  inputs.current[c.code] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.set("file", f);
                  run(c.code, () => upsertCategoryFilterImage(c.code, fd));
                }}
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
                {c.imageUrl ? "Remplacer" : "Image"}
              </button>
              {c.imageUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(c.code, () => deleteCategoryFilterImage(c.code))
                  }
                  className="text-muted hover:text-foreground shrink-0 text-xs font-semibold underline disabled:opacity-50"
                >
                  Retirer l&apos;image
                </button>
              )}

              {/* Suppression (refusée côté serveur si utilisée) */}
              <button
                type="button"
                disabled={busy || c.merchants > 0}
                title={
                  c.merchants > 0
                    ? "Des commerçants utilisent cette catégorie — masquez-la."
                    : "Supprimer la catégorie"
                }
                onClick={() => run(c.code, () => deleteCategory(c.code))}
                className="text-danger-600 hover:bg-danger-50 shrink-0 rounded-[10px] p-2 disabled:opacity-30"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
