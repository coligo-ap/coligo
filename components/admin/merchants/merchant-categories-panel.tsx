"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Plus, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MerchantCategoryOption } from "@/lib/data/platform";
import {
  addMerchantCategoryLink,
  listMerchantCategories,
  removeMerchantCategoryLink,
  setMerchantPrimaryCategory,
} from "@/app/admin/merchants/categories-actions";

/**
 * Fiche commerçant (hub Commerçants > Comptes) — RACCORDEMENT aux catégories :
 * catégorie PRINCIPALE (inscription, visibilité mig 0314, modèle de catalogue)
 * + catégories SECONDAIRES (liaisons marketplace, mig 0312). Panneau replié
 * par défaut ; liaisons chargées à l'ouverture ; messages INLINE.
 */

type LinkRow = {
  code: string;
  label: string;
  emoji: string;
  kind: "type" | "filter";
  source: string;
};

const SOURCE_LABEL: Record<string, string> = {
  primary: "principale",
  manual: "manuel",
  auto: "auto",
};

const STATUS_SUFFIX: Record<MerchantCategoryOption["status"], string> = {
  active: "",
  hidden: " — masquée",
  coming_soon: " — bientôt",
};

export function MerchantCategoriesPanel({
  merchantId,
  primaryCategory,
  options,
}: {
  merchantId: string;
  primaryCategory: string | null;
  options: MerchantCategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [primary, setPrimary] = useState(primaryCategory);
  const [addCode, setAddCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [, start] = useTransition();

  const reload = () =>
    start(async () => {
      const r = await listMerchantCategories(merchantId);
      if (r.error) setMsg({ text: r.error, error: true });
      setLinks(r.links);
      setPrimary(r.primary);
      setLoaded(true);
    });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) reload();
  };

  const act = (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okText: string
  ) => {
    setBusy(true);
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(
        r.error
          ? { text: r.error, error: true }
          : { text: okText, error: false }
      );
      setBusy(false);
      reload();
      router.refresh();
    });
  };

  const typeOptions = options.filter((o) => o.kind === "type");
  const linkedCodes = new Set(links.map((l) => l.code));
  const addable = options.filter((o) => !linkedCodes.has(o.code));

  return (
    <div className="border-border mt-4 border-t pt-4">
      <button
        type="button"
        onClick={toggle}
        className="text-foreground inline-flex items-center gap-2 text-sm font-semibold"
      >
        <Tags className="size-4" />
        Catégories
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {!loaded ? (
            <p className="text-muted flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> Chargement…
            </p>
          ) : (
            <>
              {/* Catégorie principale : pilote l'inscription, la visibilité
                  (mig 0314 : principale masquée = commerce masqué) et le
                  modèle de catalogue. */}
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-muted text-caption font-medium">
                  Principale
                </label>
                <select
                  value={primary ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    act(
                      () =>
                        setMerchantPrimaryCategory(merchantId, e.target.value),
                      "Catégorie principale mise à jour."
                    )
                  }
                  className="border-border-strong bg-surface rounded-control h-9 min-w-0 flex-1 border px-2 text-xs font-semibold"
                  aria-label="Catégorie principale"
                >
                  {!primary && <option value="">— Aucune —</option>}
                  {typeOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.emoji} {o.label}
                      {STATUS_SUFFIX[o.status]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-subtle text-caption">
                La principale pilote l&apos;inscription, le modèle de catalogue
                et la visibilité : si sa catégorie est « masquée », le commerce
                disparaît du marketplace. L&apos;ancienne principale reste en
                secondaire.
              </p>

              {/* Liaisons (principale + secondaires + filtres éditoriaux). */}
              <ul className="flex flex-wrap gap-1.5">
                {links.map((l) => (
                  <li
                    key={l.code}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                      l.source === "primary"
                        ? "border-primary-400 bg-primary-50 text-primary-700 font-semibold"
                        : "border-border bg-surface"
                    )}
                  >
                    <span aria-hidden>{l.emoji}</span>
                    {l.label}
                    <span className="text-subtle">
                      ({l.kind === "filter" ? "filtre · " : ""}
                      {SOURCE_LABEL[l.source] ?? l.source})
                    </span>
                    {l.source !== "primary" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              removeMerchantCategoryLink(merchantId, l.code),
                            "Catégorie retirée."
                          )
                        }
                        aria-label={`Retirer ${l.label}`}
                        className="text-danger-600"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
                {links.length === 0 && (
                  <li className="text-muted text-xs">
                    Aucune catégorie liée pour le moment.
                  </li>
                )}
              </ul>

              {/* Ajout d'une catégorie secondaire ou d'un filtre éditorial. */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={addCode}
                  disabled={busy || addable.length === 0}
                  onChange={(e) => setAddCode(e.target.value)}
                  className="border-border-strong bg-surface rounded-control h-9 min-w-0 flex-1 border px-2 text-xs"
                  aria-label="Catégorie à ajouter"
                >
                  <option value="">
                    {addable.length === 0
                      ? "Toutes les catégories sont déjà liées"
                      : "Ajouter une catégorie…"}
                  </option>
                  {addable.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.emoji} {o.label}
                      {o.kind === "filter" ? " (filtre éditorial)" : ""}
                      {STATUS_SUFFIX[o.status]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !addCode}
                  onClick={() => {
                    const code = addCode;
                    setAddCode("");
                    act(
                      () => addMerchantCategoryLink(merchantId, code),
                      "Catégorie ajoutée."
                    );
                  }}
                  className="bg-primary-600 rounded-control inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Ajouter
                </button>
              </div>

              {msg && (
                <p
                  className={cn(
                    "text-xs font-semibold",
                    msg.error ? "text-danger-600" : "text-success-700"
                  )}
                >
                  {msg.text}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
