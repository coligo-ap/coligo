"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  reorderCategories,
  setCategoryVisibility,
} from "@/app/admin/(plateforme)/categories/actions";
import { CategoryRow, CreateCategoryForm } from "./categories-panels";
import type { AdminCategory } from "./categories-shared";

// Chemin d'import stable si un consommateur importe le type d'ici.
export type { AdminCategory } from "./categories-shared";

type Segment = "all" | "type" | "filter";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "type", label: "Types de commerce" },
  { id: "filter", label: "Filtres éditoriaux" },
];

export function CategoriesManager({
  categories,
}: {
  categories: AdminCategory[];
}) {
  const router = useRouter();
  const [, start] = useTransition();

  // Copie locale ORDONNÉE (optimiste). Resynchronisée depuis le serveur
  // uniquement quand aucune écriture n'est en vol (sinon un router.refresh
  // en cours écraserait un drag/toggle tout juste appliqué).
  const [cats, setCats] = useState<AdminCategory[]>(categories);
  const pendingRef = useRef(0);
  useEffect(() => {
    if (pendingRef.current === 0) setCats(categories);
  }, [categories]);

  const [segment, setSegment] = useState<Segment>("all");
  const [q, setQ] = useState("");
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [globalErr, setGlobalErr] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // ─── Écriture serveur générique (busy + erreur inline + refresh) ───
  const run = (
    code: string,
    fn: () => Promise<{ error?: string }>,
    onErr?: () => void
  ) => {
    setBusyCode(code);
    setErrs((e) => ({ ...e, [code]: "" }));
    pendingRef.current += 1;
    start(async () => {
      const r = await fn();
      if (r.error) {
        setErrs((e) => ({ ...e, [code]: r.error! }));
        onErr?.();
      }
      setBusyCode(null);
      pendingRef.current -= 1;
      router.refresh();
    });
  };

  // ─── Vue filtrée (l'ordre global est TOUJOURS respecté) ───
  const needle = q.trim().toLowerCase();
  const isVisible = (c: AdminCategory) =>
    (segment === "all" || c.kind === segment) &&
    (!needle ||
      c.label.toLowerCase().includes(needle) ||
      c.labelAr.includes(needle) ||
      c.code.includes(needle));
  const visible = useMemo(
    () => cats.filter(isVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cats, segment, needle]
  );

  // ─── RECLASSEMENT : permutation dans les créneaux visibles ───
  // En vue filtrée, seules les lignes affichées échangent leurs positions
  // globales — les lignes cachées gardent exactement leur place.
  const commitVisibleOrder = (newVisible: AdminCategory[]) => {
    const slots: number[] = [];
    cats.forEach((c, i) => {
      if (isVisible(c)) slots.push(i);
    });
    const next = [...cats];
    newVisible.forEach((c, k) => {
      next[slots[k]] = c;
    });
    const prev = cats;
    setCats(next);
    setGlobalErr(null);
    pendingRef.current += 1;
    start(async () => {
      const r = await reorderCategories(next.map((c) => c.code));
      if (r.error) {
        setGlobalErr(r.error);
        setCats(prev);
      }
      pendingRef.current -= 1;
      router.refresh();
    });
  };

  const moveVisible = (from: number, to: number) => {
    if (to < 0 || to >= visible.length || from === to) return;
    const arr = [...visible];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    commitVisibleOrder(arr);
  };

  // ─── Drag & drop (poignée draggable, indicateur d'insertion) ───
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{
    code: string;
    after: boolean;
  } | null>(null);

  const onRowDragOver = (e: DragEvent, code: string) => {
    if (!dragCode || dragCode === code) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt({ code, after: e.clientY > rect.top + rect.height / 2 });
  };

  const onRowDrop = () => {
    if (!dragCode || !dropAt) return;
    const from = visible.findIndex((c) => c.code === dragCode);
    let to = visible.findIndex((c) => c.code === dropAt.code);
    if (from < 0 || to < 0) return;
    if (dropAt.after) to += 1;
    if (to > from) to -= 1; // l'élément retiré décale les index suivants
    setDragCode(null);
    setDropAt(null);
    moveVisible(from, to);
  };

  // ─── Bascule optimiste d'une visibilité ───
  const toggleVisibility = (
    c: AdminCategory,
    key: "showMarketplace" | "showSignup"
  ) => {
    const val = !c[key];
    setCats((prev) =>
      prev.map((x) => (x.code === c.code ? { ...x, [key]: val } : x))
    );
    run(
      c.code,
      () =>
        setCategoryVisibility(
          c.code,
          key === "showMarketplace"
            ? { showMarketplace: val }
            : { showSignup: val }
        ),
      () =>
        setCats((prev) =>
          prev.map((x) => (x.code === c.code ? { ...x, [key]: !val } : x))
        )
    );
  };

  const nbTypes = cats.filter((c) => c.kind === "type").length;
  const nbFilters = cats.length - nbTypes;
  const nbHidden = cats.filter((c) => c.status === "hidden").length;

  return (
    <div className="mt-4">
      {/* ─── Barre d'outils : segments + recherche + création ─── */}
      <div className="bg-surface sticky top-0 z-10 -mx-1 space-y-2 px-1 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="border-border bg-surface-2 flex rounded-md border p-0.5">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                className={cn(
                  "rounded-control px-3 py-1.5 text-xs font-bold transition-colors",
                  segment === s.id
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[160px] flex-1">
            <Search className="text-muted absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Chercher (libellé, code…)"
              className="border-border-strong bg-surface rounded-control h-9 w-full border pr-8 pl-8 text-xs"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Effacer la recherche"
                className="text-muted hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="bg-primary-600 rounded-control inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-bold text-white"
          >
            <Plus className="size-3.5" /> Nouvelle catégorie
          </button>
        </div>
        <p className="text-subtle text-caption">
          {nbTypes} types · {nbFilters} filtres éditoriaux
          {nbHidden > 0
            ? ` · ${nbHidden} masqué${nbHidden > 1 ? "s" : ""}`
            : ""}{" "}
          — glissez la poignée (ou flèches) pour reclasser :{" "}
          <strong>cet ordre est celui du strip marketplace</strong>. Chips : où
          la catégorie s&apos;affiche (marketplace / inscription).
        </p>
        {globalErr && (
          <p className="text-danger-600 text-xs font-semibold">{globalErr}</p>
        )}
      </div>

      {showCreate && (
        <CreateCategoryForm
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}

      {/* ─── Liste ─── */}
      <ul className="mt-2 space-y-1.5">
        {visible.length === 0 && (
          <li className="text-muted border-border rounded-md border border-dashed p-6 text-center text-xs">
            Aucune catégorie ne correspond.
          </li>
        )}
        {visible.map((c, idx) => (
          <CategoryRow
            key={c.code}
            cat={c}
            busy={busyCode === c.code}
            err={errs[c.code]}
            open={openCode === c.code}
            onToggleOpen={() =>
              setOpenCode(openCode === c.code ? null : c.code)
            }
            onToggleVisibility={(key) => toggleVisibility(c, key)}
            onRun={(fn) => run(c.code, fn)}
            onMoveUp={() => moveVisible(idx, idx - 1)}
            onMoveDown={() => moveVisible(idx, idx + 1)}
            canUp={idx > 0}
            canDown={idx < visible.length - 1}
            dragging={dragCode === c.code}
            dropIndicator={dropAt?.code === c.code ? dropAt.after : null}
            onDragStart={() => setDragCode(c.code)}
            onDragEnd={() => {
              setDragCode(null);
              setDropAt(null);
            }}
            onDragOver={(e) => onRowDragOver(e, c.code)}
            onDrop={onRowDrop}
            onRefresh={() => router.refresh()}
          />
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────── Ligne catégorie ─────────────────────────── */
