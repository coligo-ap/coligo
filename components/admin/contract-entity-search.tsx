"use client";

import { useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// =============================================================================
// Recherche intelligente d'une entité (commerçant / livreur / chauffeur) pour
// le pré-remplissage des contrats : insensible aux accents et à la casse,
// multi-mots (chaque mot doit matcher le nom OU le sous-titre), navigation
// clavier (flèches + Entrée, Échap). Sélection affichée en « chip ».
// =============================================================================

export type SearchOption = {
  id: string;
  name: string;
  /** Sous-titre cherchable (commune, wilaya, téléphone…). */
  sub: string;
  /** Dossier pas encore validé — badge « en attente ». */
  pending: boolean;
};

const foldText = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ContractEntitySearch({
  options,
  value,
  onPick,
  busy,
  placeholder,
  inputId,
}: {
  options: SearchOption[];
  value: string;
  onPick: (id: string) => void;
  busy: boolean;
  placeholder: string;
  inputId?: string;
}) {
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const [hi, setHi] = useState(0);
  const selected = options.find((o) => o.id === value) ?? null;

  const tokens = foldText(q).split(/\s+/).filter(Boolean);
  const results = (
    tokens.length === 0
      ? options
      : options.filter((o) => {
          const hay = foldText(`${o.name} ${o.sub}`);
          return tokens.every((t) => hay.includes(t));
        })
  ).slice(0, 8);

  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setOpenList(false);
  };

  if (selected) {
    return (
      <div className="border-primary-200 bg-primary-50 rounded-control flex items-center gap-2 border px-3 py-2">
        <Search className="text-primary-600 size-4 shrink-0" />
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          {selected.name}
          {selected.sub && (
            <span className="text-muted font-normal"> · {selected.sub}</span>
          )}
          {selected.pending && (
            <span className="bg-warning-500 text-micro ml-2 rounded-full px-1.5 py-0.5 font-bold text-white">
              dossier en attente
            </span>
          )}
        </span>
        {busy ? (
          <Loader2 className="text-muted size-4 shrink-0 animate-spin" />
        ) : (
          <button
            type="button"
            aria-label="Retirer la sélection (saisie manuelle)"
            className="text-muted hover:text-foreground shrink-0 rounded-full p-1"
            onClick={() => pick("")}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id={inputId}
          value={q}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setOpenList(true);
            setHi(0);
          }}
          onFocus={() => setOpenList(true)}
          onBlur={() => setOpenList(false)}
          onKeyDown={(e) => {
            if (!openList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (results[hi]) pick(results[hi].id);
            } else if (e.key === "Escape") {
              setOpenList(false);
            }
          }}
        />
      </div>

      {openList && (
        <ul
          className="border-border bg-surface absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border shadow-lg"
          // Empêche le blur de l'input avant le clic sur une option.
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.length === 0 ? (
            <li className="text-muted px-3 py-2.5 text-sm">
              Aucun résultat pour « {q} » — laissez vide pour une saisie
              manuelle.
            </li>
          ) : (
            results.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm",
                    i === hi ? "bg-primary-50" : "hover:bg-surface-2"
                  )}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o.id)}
                >
                  <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                    {o.name}
                    {o.sub && (
                      <span className="text-muted font-normal"> · {o.sub}</span>
                    )}
                  </span>
                  {o.pending && (
                    <span className="bg-warning-500 text-micro shrink-0 rounded-full px-1.5 py-0.5 font-bold text-white">
                      en attente
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
