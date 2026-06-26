"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
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
  initialGroups,
}: {
  productId: string;
  initialGroups: LoadedOptionGroup[];
}) {
  const [groups, setGroups] = useState<GroupState[]>(() =>
    fromLoaded(initialGroups)
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      toast.success("Options enregistrées");
    });
  }

  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-base">Options & variantes</Label>
          <p className="text-muted text-xs">
            Taille, suppléments, choix… proposés au client. Bilingue FR/AR.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="size-4" />
          Groupe
        </Button>
      </div>

      {groups.length === 0 && (
        <p className="text-subtle py-2 text-sm">
          Aucune option. Ajoutez un groupe (ex. « Taille », « Suppléments »).
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
            <Input
              value={g.name_ar}
              onChange={(e) => patchGroup(gi, { name_ar: e.target.value })}
              placeholder="اسم المجموعة"
              dir="rtl"
              disabled={pending}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={g.required}
                onChange={(e) => patchGroup(gi, { required: e.target.checked })}
                disabled={pending}
                className="accent-primary-600 size-4"
              />
              Choix obligatoire
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={g.multi}
                onChange={(e) => patchGroup(gi, { multi: e.target.checked })}
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
                <div className="flex items-center gap-1">
                  <Input
                    value={o.price_delta_da}
                    onChange={(e) =>
                      patchOption(gi, oi, { price_delta_da: e.target.value })
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
                      patchOption(gi, oi, { is_available: e.target.checked })
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
    </section>
  );
}
