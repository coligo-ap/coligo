"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Loader2, Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { TranslateArButton } from "@/components/merchant/translate-ar-button";
import {
  saveProductOptions,
  type LoadedOptionGroup,
  type OptionGroupInput,
  type OptionInput,
} from "@/app/(merchant)/catalog/options/actions";

/**
 * Éditeur d'options / variantes d'un produit (façon Deliveroo). Bilingue FR/AR.
 * Modèle : un GROUPE (« Taille », « Suppléments ») contient des OPTIONS
 * (« Grand », « Fromage +50 DA »). `requis` = au moins un choix (min_select),
 * `choix multiple` = plusieurs options cochables (max_select > 1) vs variante
 * exclusive (radio). Sauvegarde en « remplacer tout » (cf. action).
 */

type GroupState = {
  name_fr: string;
  name_ar: string;
  required: boolean; // min_select >= 1
  multi: boolean; // max_select > 1
  options: {
    name_fr: string;
    name_ar: string;
    price_delta_da: string;
    is_available: boolean;
  }[];
};

const MULTI_MAX = 99;

function fromLoaded(groups: LoadedOptionGroup[]): GroupState[] {
  return groups.map((g) => ({
    name_fr: g.name_fr,
    name_ar: g.name_ar ?? "",
    required: g.min_select >= 1,
    multi: g.max_select > 1,
    options: g.options.map((o) => ({
      name_fr: o.name_fr,
      name_ar: o.name_ar ?? "",
      price_delta_da: String(o.price_delta_da ?? 0),
      is_available: o.is_available,
    })),
  }));
}

function toInput(groups: GroupState[]): OptionGroupInput[] {
  return groups.map((g) => ({
    name_fr: g.name_fr,
    name_ar: g.name_ar || null,
    min_select: g.required ? 1 : 0,
    max_select: g.multi ? MULTI_MAX : 1,
    options: g.options.map<OptionInput>((o) => ({
      name_fr: o.name_fr,
      name_ar: o.name_ar || null,
      price_delta_da: Number(o.price_delta_da) || 0,
      is_available: o.is_available,
    })),
  }));
}

export function ProductOptionsEditor({
  productId,
  initialGroups = [],
  defaultOpen = false,
  onDraftChange,
}: {
  /** Absent en mode BROUILLON (création : le produit n'existe pas encore). */
  productId?: string;
  initialGroups?: LoadedOptionGroup[];
  /** Ouvert d'emblée (onglet dédié « Options & variantes »). */
  defaultOpen?: boolean;
  /** Mode BROUILLON (page de création) : pas de bouton Enregistrer — chaque
   *  changement remonte au parent, qui le soumet AVEC le formulaire produit
   *  (champ caché `options_json` → `createProduct`). */
  onDraftChange?: (groups: OptionGroupInput[]) => void;
}) {
  const isDraft = !!onDraftChange;
  const [groups, setGroups] = useState<GroupState[]>(() =>
    fromLoaded(initialGroups)
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useActionNote();
  // Section repliée par défaut hors onglet dédié : la plupart des produits n'ont
  // pas d'options, le compteur dans l'en-tête suffit pour savoir s'il y en a.
  const [open, setOpen] = useState(defaultOpen);

  // Brouillon : remonte l'état au parent à chaque frappe (panneau monté en
  // permanence dans les onglets → aucune perte de saisie).
  useEffect(() => {
    onDraftChange?.(toInput(groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const groupCount = groups.length;
  const optionCount = groups.reduce((n, g) => n + g.options.length, 0);

  function patchGroup(gi: number, patch: Partial<GroupState>) {
    setGroups((prev) =>
      prev.map((g, i) => (i === gi ? { ...g, ...patch } : g))
    );
  }
  function patchOption(
    gi: number,
    oi: number,
    patch: Partial<GroupState["options"][number]>
  ) {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? {
              ...g,
              options: g.options.map((o, j) =>
                j === oi ? { ...o, ...patch } : o
              ),
            }
          : g
      )
    );
  }

  function addGroup() {
    setGroups((prev) => [
      ...prev,
      { name_fr: "", name_ar: "", required: false, multi: false, options: [] },
    ]);
  }
  function removeGroup(gi: number) {
    setGroups((prev) => prev.filter((_, i) => i !== gi));
  }
  function addOption(gi: number) {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? {
              ...g,
              options: [
                ...g.options,
                {
                  name_fr: "",
                  name_ar: "",
                  price_delta_da: "0",
                  is_available: true,
                },
              ],
            }
          : g
      )
    );
  }
  function removeOption(gi: number, oi: number) {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi ? { ...g, options: g.options.filter((_, j) => j !== oi) } : g
      )
    );
  }

  function save() {
    if (!productId) return; // brouillon : soumis avec le formulaire produit
    setError(null);
    // Validation légère : un groupe nommé doit avoir au moins une option nommée.
    for (const g of groups) {
      if (g.name_fr.trim() && !g.options.some((o) => o.name_fr.trim())) {
        setError(
          `Le groupe « ${g.name_fr.trim()} » doit avoir au moins une option.`
        );
        return;
      }
    }
    startTransition(async () => {
      const res = await saveProductOptions(productId, toInput(groups));
      if (res.error) {
        setError(res.error);
        return;
      }
      setNote({ ok: true, text: "Options enregistrées" });
    });
  }

  return (
    <section className="border-border bg-surface rounded-[16px] border">
      {/* En-tête cliquable : replié par défaut, compteur toujours visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] p-5 text-left"
      >
        <div>
          <span className="text-sm font-medium">Options & variantes</span>
          <p className="text-muted text-xs">
            Taille, suppléments, choix… proposés au client. Bilingue FR/AR.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="border-border bg-surface-2 text-muted rounded-full border px-2.5 py-0.5 text-xs font-medium">
            {groupCount} groupe{groupCount > 1 ? "s" : ""} · {optionCount}{" "}
            option{optionCount > 1 ? "s" : ""}
          </span>
          <ChevronDown
            className={cn(
              "text-muted size-4 transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {open && (
        <div className="border-border space-y-4 border-t p-5">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addGroup}
            >
              <Plus className="size-4" />
              Groupe
            </Button>
          </div>

          {groups.length === 0 && (
            <p className="text-subtle py-2 text-sm">
              Aucune option. Ajoutez un groupe (ex. « Taille », « Suppléments
              »).
            </p>
          )}

          {groups.map((g, gi) => (
            <div
              key={gi}
              className="border-border-strong space-y-3 rounded-[12px] border p-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={g.name_fr}
                  onChange={(e) => patchGroup(gi, { name_fr: e.target.value })}
                  placeholder="Nom du groupe (ex. Taille)"
                  disabled={pending}
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={g.name_ar}
                    onChange={(e) =>
                      patchGroup(gi, { name_ar: e.target.value })
                    }
                    placeholder="اسم المجموعة"
                    dir="rtl"
                    disabled={pending}
                  />
                  <TranslateArButton
                    compact
                    disabled={pending}
                    getSource={() => g.name_fr}
                    onTranslated={(value) => patchGroup(gi, { name_ar: value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={g.required}
                    onChange={(e) =>
                      patchGroup(gi, { required: e.target.checked })
                    }
                    disabled={pending}
                    className="accent-primary-600 size-4"
                  />
                  Choix obligatoire
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={g.multi}
                    onChange={(e) =>
                      patchGroup(gi, { multi: e.target.checked })
                    }
                    disabled={pending}
                    className="accent-primary-600 size-4"
                  />
                  Choix multiple
                </label>
                <button
                  type="button"
                  onClick={() => removeGroup(gi)}
                  disabled={pending}
                  className="text-danger-600 hover:bg-danger-50 ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Supprimer le groupe
                </button>
              </div>

              {/* Options du groupe */}
              <div className="space-y-2">
                {g.options.map((o, oi) => (
                  <div
                    key={oi}
                    className="border-border bg-surface-2 grid items-center gap-2 rounded-[10px] border p-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
                  >
                    <Input
                      value={o.name_fr}
                      onChange={(e) =>
                        patchOption(gi, oi, { name_fr: e.target.value })
                      }
                      placeholder="Option (ex. Grand)"
                      disabled={pending}
                      className="h-10"
                    />
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={o.name_ar}
                        onChange={(e) =>
                          patchOption(gi, oi, { name_ar: e.target.value })
                        }
                        placeholder="الخيار"
                        dir="rtl"
                        disabled={pending}
                        className="h-10"
                      />
                      <TranslateArButton
                        compact
                        disabled={pending}
                        getSource={() => o.name_fr}
                        onTranslated={(value) =>
                          patchOption(gi, oi, { name_ar: value })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        value={o.price_delta_da}
                        onChange={(e) =>
                          patchOption(gi, oi, {
                            price_delta_da: e.target.value,
                          })
                        }
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        disabled={pending}
                        className="h-10 w-20"
                        aria-label="Supplément en DA"
                      />
                      <span className="text-muted text-xs">DA</span>
                    </div>
                    <label
                      className="flex items-center gap-1.5 text-xs"
                      title="Disponible"
                    >
                      <input
                        type="checkbox"
                        checked={o.is_available}
                        onChange={(e) =>
                          patchOption(gi, oi, {
                            is_available: e.target.checked,
                          })
                        }
                        disabled={pending}
                        className="accent-primary-600 size-4"
                      />
                      Dispo
                    </label>
                    <button
                      type="button"
                      onClick={() => removeOption(gi, oi)}
                      disabled={pending}
                      className="text-danger-600 hover:bg-danger-50 inline-flex size-8 items-center justify-center rounded-[8px] disabled:opacity-50"
                      aria-label="Supprimer l'option"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(gi)}
                  disabled={pending}
                  className="text-primary-700 hover:text-primary-800 inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50"
                >
                  <Plus className="size-3.5" />
                  Ajouter une option
                </button>
              </div>
            </div>
          ))}

          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
              {error}
            </div>
          )}

          {isDraft ? (
            <p className="text-subtle text-xs">Enregistrées avec le produit.</p>
          ) : (
            <>
              <Button type="button" onClick={save} disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enregistrement…
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    Enregistrer les options
                  </>
                )}
              </Button>
              <ActionNote note={note} className="mt-2" />
            </>
          )}
        </div>
      )}
    </section>
  );
}
