"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardList,
  GripVertical,
  Loader2,
  Lock,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  attachMerchantToFilter,
  createCategory,
  deleteCategory,
  deleteCategoryFilterImage,
  detachMerchantFromFilter,
  listFilterMerchants,
  recomputeAutoLinks,
  searchMerchantsForFilter,
  setCategoryKeywords,
  setCategoryStatus,
  updateCategoryLabels,
  upsertCategoryFilterImage,
} from "@/app/admin/(plateforme)/categories/actions";
import { STATUS_LABEL, type AdminCategory } from "./categories-shared";

export function CategoryRow({
  cat: c,
  busy,
  err,
  open,
  onToggleOpen,
  onToggleVisibility,
  onRun,
  onMoveUp,
  onMoveDown,
  canUp,
  canDown,
  dragging,
  dropIndicator,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRefresh,
}: {
  cat: AdminCategory;
  busy: boolean;
  err?: string;
  open: boolean;
  onToggleOpen: () => void;
  onToggleVisibility: (key: "showMarketplace" | "showSignup") => void;
  onRun: (fn: () => Promise<{ error?: string }>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canUp: boolean;
  canDown: boolean;
  dragging: boolean;
  /** null = pas de survol ; false = insérer AVANT ; true = insérer APRÈS. */
  dropIndicator: boolean | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: () => void;
  onRefresh: () => void;
}) {
  return (
    <li
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "border-border bg-surface rounded-card-lg relative border transition-opacity",
        dragging && "opacity-40",
        dropIndicator === false && "border-t-primary-500 border-t-2",
        dropIndicator === true && "border-b-primary-500 border-b-2"
      )}
    >
      <div className="flex items-center gap-2.5 p-2.5">
        {/* Poignée de drag + flèches (clavier/mobile) */}
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c.code);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onMoveUp();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                onMoveDown();
              }
            }}
            title="Glisser pour reclasser (ou flèches ↑/↓ au clavier)"
            aria-label={`Reclasser ${c.label}`}
            className="text-subtle hover:text-foreground cursor-grab p-0.5 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex flex-col">
            <button
              type="button"
              disabled={!canUp}
              onClick={onMoveUp}
              aria-label={`Monter ${c.label}`}
              className="text-subtle hover:text-foreground p-0.5 disabled:opacity-20"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              type="button"
              disabled={!canDown}
              onClick={onMoveDown}
              aria-label={`Descendre ${c.label}`}
              className="text-subtle hover:text-foreground p-0.5 disabled:opacity-20"
            >
              <ArrowDown className="size-3" />
            </button>
          </div>
        </div>

        {/* Rond (image admin ou emoji de la catégorie, donnée pilotée en base) */}
        <span className="border-border bg-surface-2 grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border text-xl">
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

        {/* Identité + méta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{c.label}</span>
            <span
              className={cn(
                "text-micro shrink-0 rounded-full px-1.5 py-px font-bold uppercase",
                c.kind === "filter"
                  ? "bg-accent-50 text-accent-700"
                  : "bg-surface-3 text-muted"
              )}
            >
              {c.kind === "filter" ? "Filtre" : "Type"}
            </span>
            {c.status !== "active" && (
              <span
                className={cn(
                  "text-micro shrink-0 rounded-full px-1.5 py-px font-bold",
                  c.status === "hidden"
                    ? "bg-danger-50 text-danger-600"
                    : "bg-warning-50 text-warning-700"
                )}
              >
                {STATUS_LABEL[c.status]}
              </span>
            )}
          </div>
          <p className="text-subtle truncate text-xs">
            {c.code} · {c.labelAr}
            {c.kind === "filter"
              ? ` · ${c.links} lié${c.links > 1 ? "s" : ""}`
              : ` · ${c.merchants} commerçant${c.merchants > 1 ? "s" : ""}${
                  c.links > 0 ? ` (+${c.links} secondaires)` : ""
                }`}
          </p>
          {err ? (
            <p className="text-danger-600 text-xs font-semibold">{err}</p>
          ) : null}
        </div>

        {/* Visibilité par surface : chips à bascule optimistes */}
        <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
          <VisibilityChip
            on={c.showMarketplace}
            icon={<Store className="size-3.5" />}
            label="Marketplace"
            title="Afficher dans le strip de filtres du marketplace"
            disabled={busy}
            onClick={() => onToggleVisibility("showMarketplace")}
          />
          <VisibilityChip
            on={c.showSignup}
            icon={<ClipboardList className="size-3.5" />}
            label="Inscription"
            title="Proposer dans la liste d'inscription des commerçants"
            disabled={busy}
            onClick={() => onToggleVisibility("showSignup")}
          />
        </div>

        {busy ? (
          <Loader2 className="text-muted size-4 shrink-0 animate-spin" />
        ) : (
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={`Détails ${c.label}`}
            className={cn(
              "rounded-control shrink-0 p-1.5 transition-transform",
              open
                ? "bg-primary-50 text-primary-700 rotate-180"
                : "text-muted hover:text-foreground"
            )}
          >
            <ChevronDown className="size-4" />
          </button>
        )}
      </div>

      {open && <CategoryDetail cat={c} onRun={onRun} onRefresh={onRefresh} />}
    </li>
  );
}

function VisibilityChip({
  on,
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-caption inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold transition-colors disabled:opacity-50",
        on
          ? "border-primary-300 bg-primary-50 text-primary-700"
          : "border-border bg-surface-2 text-subtle line-through"
      )}
    >
      {icon}
      {label}
      {on ? <Check className="size-3" /> : <X className="size-3" />}
    </button>
  );
}

/* ─────────────────── Panneau de détail (par ligne) ─────────────────── */

function CategoryDetail({
  cat: c,
  onRun,
  onRefresh,
}: {
  cat: AdminCategory;
  onRun: (fn: () => Promise<{ error?: string }>) => void;
  onRefresh: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState(c.label);
  const [labelAr, setLabelAr] = useState(c.labelAr);
  const [emoji, setEmoji] = useState(c.emoji);
  const renamed =
    label !== c.label || labelAr !== c.labelAr || emoji !== c.emoji;
  const undeletable =
    c.kind !== "filter" && (c.merchants > 0 || c.linksTotal > 0);

  return (
    <div className="border-border space-y-3 border-t p-3">
      {/* Statut + image */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted text-xs font-semibold">Statut</label>
        <select
          value={c.status}
          onChange={(e) =>
            onRun(() =>
              setCategoryStatus(
                c.code,
                e.target.value as AdminCategory["status"]
              )
            )
          }
          className="border-border-strong bg-surface rounded-control h-9 border px-2 text-xs font-semibold"
          aria-label={`Statut ${c.label}`}
        >
          {(Object.keys(STATUS_LABEL) as AdminCategory["status"][]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-subtle text-caption">
          « Masqué » retire aussi du marketplace les commerces dont c&apos;est
          la catégorie principale.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.set("file", f);
            onRun(() => upsertCategoryFilterImage(c.code, fd));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="border-border bg-surface-2 hover:bg-surface-3 rounded-control inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-semibold"
        >
          <Upload className="size-3.5" />
          {c.imageUrl ? "Remplacer l'image" : "Image du rond"}
        </button>
        {c.imageUrl && (
          <button
            type="button"
            onClick={() => onRun(() => deleteCategoryFilterImage(c.code))}
            className="text-muted hover:text-foreground text-xs font-semibold underline"
          >
            Retirer l&apos;image
          </button>
        )}
        <span className="text-subtle text-caption">
          PNG/WebP carré, max 2 Mo — sinon l&apos;emoji.
        </span>
      </div>

      {/* Renommage (le code technique est immuable) */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Libellé FR"
            className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs sm:col-span-2"
          />
          <input
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
            placeholder="Libellé AR"
            dir="rtl"
            className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs"
          />
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="Emoji"
            className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs"
          />
        </div>
        {renamed && (
          <button
            type="button"
            onClick={() =>
              onRun(() =>
                updateCategoryLabels(c.code, { label, labelAr, emoji })
              )
            }
            className="bg-primary-600 rounded-control px-4 py-2 text-xs font-bold text-white"
          >
            Enregistrer les libellés
          </button>
        )}
      </div>

      {/* Commerçants liés — pour TOUTE catégorie (type ou filtre). Les filtres
          gardent en plus le mapping auto par mots-clés. */}
      <FilterMappingPanel
        code={c.code}
        kind={c.kind}
        initialKeywords={c.keywords.join(", ")}
        onDone={onRefresh}
      />

      {/* Suppression — miroir exact de la garde serveur */}
      <div className="border-border flex items-center justify-between gap-2 border-t pt-2.5">
        <span className="text-subtle text-caption">
          {undeletable
            ? "Des commerçants utilisent cette catégorie (principale ou liaison) — masquez-la plutôt."
            : c.kind === "filter"
              ? "Un filtre éditorial part avec son mapping."
              : "Catégorie inutilisée : suppression possible."}
        </span>
        <button
          type="button"
          disabled={undeletable}
          onClick={() => onRun(() => deleteCategory(c.code))}
          className="text-danger-600 hover:bg-danger-50 rounded-control inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold disabled:opacity-30"
        >
          <Trash2 className="size-3.5" /> Supprimer
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Création ───────────────────────── */

export function CreateCategoryForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [, start] = useTransition();
  const [kind, setKind] = useState<"type" | "filter">("type");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [label, setLabel] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [emoji, setEmoji] = useState("");
  const [keywords, setKeywords] = useState("");
  const [showMarketplace, setShowMarketplace] = useState(true);
  const [showSignup, setShowSignup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Le code technique se propose tout seul depuis le libellé FR (modifiable).
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

  const pickKind = (k: "type" | "filter") => {
    setKind(k);
    // Défauts par nature (ajustables) : un filtre n'est pas proposé à l'inscription.
    setShowSignup(k === "type");
    setShowMarketplace(true);
  };

  return (
    <div className="border-border bg-surface-2 rounded-card-lg mt-2 space-y-2.5 border p-3">
      <div className="flex gap-2">
        {(
          [
            ["type", "Type de commerce"],
            ["filter", "Filtre éditorial (mapping par mots-clés)"],
          ] as const
        ).map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => pickKind(k)}
            className={cn(
              "rounded-control flex-1 border px-2 py-2 text-xs font-semibold",
              kind === k
                ? "border-primary-400 bg-primary-50 text-primary-700"
                : "border-border-strong bg-surface text-muted"
            )}
          >
            {lbl}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (!codeTouched) setCode(slugify(e.target.value));
          }}
          placeholder="Libellé FR"
          className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs"
        />
        <input
          value={labelAr}
          onChange={(e) => setLabelAr(e.target.value)}
          placeholder="Libellé AR"
          dir="rtl"
          className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs"
        />
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeTouched(true);
          }}
          placeholder="code_technique (auto)"
          className="border-border-strong bg-surface rounded-control h-9 border px-2.5 font-mono text-xs"
        />
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="Emoji (ex. 🌮)"
          className="border-border-strong bg-surface rounded-control h-9 border px-2.5 text-xs"
        />
      </div>
      {kind === "filter" && (
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Mots-clés du mapping auto (ex. burger, hamburger)"
          className="border-border-strong bg-surface rounded-control h-9 w-full border px-2.5 text-xs"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted text-xs font-semibold">Affichage :</span>
        <VisibilityChip
          on={showMarketplace}
          icon={<Store className="size-3.5" />}
          label="Marketplace"
          title="Afficher dans le strip de filtres du marketplace"
          disabled={busy}
          onClick={() => setShowMarketplace((v) => !v)}
        />
        <VisibilityChip
          on={showSignup}
          icon={<ClipboardList className="size-3.5" />}
          label="Inscription"
          title="Proposer dans la liste d'inscription des commerçants"
          disabled={busy}
          onClick={() => setShowSignup((v) => !v)}
        />
      </div>
      {err && <p className="text-danger-600 text-xs font-semibold">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            start(async () => {
              const r = await createCategory({
                code,
                label,
                labelAr,
                emoji,
                kind,
                keywords,
                showMarketplace,
                showSignup,
              });
              setBusy(false);
              if (r.error) setErr(r.error);
              else onDone();
            });
          }}
          className="bg-primary-600 rounded-control px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "Création…" : "Créer"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="text-muted hover:text-foreground text-xs font-semibold underline"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

/* ─────────── Mapping d'un FILTRE ÉDITORIAL (phase 3) ─────────── */

const SOURCE_LABEL: Record<string, string> = {
  primary: "principale",
  manual: "manuel",
  auto: "auto",
};

function FilterMappingPanel({
  code,
  kind,
  initialKeywords,
  onDone,
}: {
  code: string;
  /** filter = mots-clés + recalcul auto en plus du mapping manuel. */
  kind: "type" | "filter";
  initialKeywords: string;
  onDone: () => void;
}) {
  const [kw, setKw] = useState(initialKeywords);
  const [rows, setRows] = useState<
    { merchantId: string; name: string; source: string }[]
  >([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const reload = () =>
    start(async () => {
      const r = await listFilterMerchants(code);
      setRows(r.rows);
    });
  // Chargement initial du panneau.
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const act = (fn: () => Promise<{ error?: string; added?: number }>) => {
    setBusy(true);
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(
        r.error ??
          (typeof r.added === "number"
            ? `${r.added} commerçant(s) liés automatiquement.`
            : null)
      );
      setBusy(false);
      reload();
      onDone();
    });
  };

  return (
    <div className="border-border bg-surface-2 space-y-2.5 rounded-md border p-3">
      <p className="text-muted text-xs font-bold uppercase">Commerçants liés</p>

      {/* Mots-clés + recalcul auto — FILTRES ÉDITORIAUX uniquement */}
      {kind === "filter" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="Mots-clés auto (ex. burger, hamburger)"
              className="border-border-strong bg-surface rounded-control h-9 min-w-0 flex-1 border px-2.5 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => setCategoryKeywords(code, kw))}
              className="border-border bg-surface rounded-control border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              Enregistrer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => recomputeAutoLinks(code))}
              className="bg-primary-600 rounded-control px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Recalculer auto
            </button>
          </div>
          <p className="text-subtle text-caption">
            Le recalcul lie les commerçants dont les produits, tags ou le nom
            contiennent un mot-clé — sans toucher aux liaisons manuelles.
          </p>
        </>
      )}

      {/* Ajout manuel */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            const needle = e.target.value;
            if (needle.trim().length >= 2) {
              start(async () => {
                const r = await searchMerchantsForFilter(needle);
                setResults(r.rows);
              });
            } else setResults([]);
          }}
          placeholder="Ajouter un commerçant (nom)…"
          className="border-border-strong bg-surface rounded-control h-9 min-w-0 flex-1 border px-2.5 text-xs"
        />
      </div>
      {results.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setQ("");
                setResults([]);
                act(() => attachMerchantToFilter(code, m.id));
              }}
              className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              + {m.name}
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-xs font-semibold">{msg}</p>}

      {/* Commerçants liés — la liaison PRINCIPALE ne se retire pas d'ici
          (elle suit merchants.category : changez-la depuis la fiche du
          commerçant, hub Commerçants). */}
      {rows.length === 0 ? (
        <p className="text-muted text-xs">
          Aucun commerçant lié —{" "}
          {kind === "filter"
            ? "ajoutez des mots-clés puis « Recalculer auto », ou liez manuellement."
            : "recherchez un commerçant ci-dessus pour le lier."}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li
              key={r.merchantId}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                r.source === "primary"
                  ? "border-primary-300 bg-primary-50"
                  : "border-border bg-surface"
              )}
            >
              {r.name}
              <span className="text-subtle">
                ({SOURCE_LABEL[r.source] ?? r.source})
              </span>
              {r.source === "primary" ? (
                <Lock
                  className="text-subtle size-3"
                  aria-label="Catégorie principale — se change depuis la fiche du commerçant (hub Commerçants)."
                >
                  <title>
                    Catégorie principale — se change depuis la fiche du
                    commerçant (hub Commerçants).
                  </title>
                </Lock>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(() => detachMerchantFromFilter(code, r.merchantId))
                  }
                  aria-label={`Retirer ${r.name}`}
                  className="text-danger-600"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
