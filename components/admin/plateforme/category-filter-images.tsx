"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
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

/**
 * ADMIN (Plateforme > Catégories) — GESTION DES CATÉGORIES / FILTRES du
 * marketplace (mig 0311) : statut (actif / masqué / bientôt disponible —
 * appliqué à l'inscription commerçant ET au strip de filtres), image du rond,
 * création de nouvelles catégories, suppression (refusée si des commerçants
 * l'utilisent). Erreurs INLINE par ligne.
 */

export type AdminCategory = {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  imageUrl: string | null;
  status: "active" | "hidden" | "coming_soon";
  /** type = inscription + filtre ; filter = FILTRE ÉDITORIAL (phase 3). */
  kind: "type" | "filter";
  keywords: string[];
  /** Commerçants dont c'est la catégorie PRINCIPALE. */
  merchants: number;
  /** Liaisons SECONDAIRES (source manuel/auto, hors principale). */
  links: number;
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
  const [nKind, setNKind] = useState<"type" | "filter">("type");
  const [nKeywords, setNKeywords] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  // Panneau de mapping (filtres éditoriaux) déplié.
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  // Édition des libellés (FR/AR + emoji) — le code technique reste immuable.
  const [editCode, setEditCode] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eLabelAr, setELabelAr] = useState("");
  const [eEmoji, setEEmoji] = useState("");

  const openEdit = (c: AdminCategory) => {
    if (editCode === c.code) {
      setEditCode(null);
      return;
    }
    setEditCode(c.code);
    setELabel(c.label);
    setELabelAr(c.labelAr);
    setEEmoji(c.emoji);
  };

  const saveLabels = (code: string) => {
    setBusyCode(code);
    setErrs((e) => ({ ...e, [code]: "" }));
    start(async () => {
      const r = await updateCategoryLabels(code, {
        label: eLabel,
        labelAr: eLabelAr,
        emoji: eEmoji,
      });
      if (r.error) setErrs((e) => ({ ...e, [code]: r.error! }));
      else setEditCode(null);
      setBusyCode(null);
      router.refresh();
    });
  };

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
    <section className="border-border bg-surface mt-5 rounded-[16px] border p-4">
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
        Statut appliqué à l&apos;inscription, au filtre marketplace ET aux
        commerçants : « Masqué » retire aussi du marketplace les commerces dont
        c&apos;est la catégorie <strong>principale</strong> (contrôle marketing
        par segment). Image : PNG/WebP carré, max 2 Mo — sinon l&apos;emoji.
        Astuce ciblage : une bannière avec le lien <code>/?category=code</code>{" "}
        pointe droit sur un segment.
      </p>

      {showCreate && (
        <div className="border-border bg-surface-2 mb-3 space-y-2 rounded-[12px] border p-3">
          {/* Nature : type de commerce (inscription) ou filtre éditorial. */}
          <div className="flex gap-2">
            {(
              [
                ["type", "Type de commerce (inscription + filtre)"],
                ["filter", "Filtre éditorial (marketplace uniquement)"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setNKind(k)}
                className={
                  "flex-1 rounded-[10px] border px-2 py-2 text-xs font-semibold " +
                  (nKind === k
                    ? "border-primary-400 bg-primary-50 text-primary-700"
                    : "border-border-strong bg-surface text-muted")
                }
              >
                {lbl}
              </button>
            ))}
          </div>
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
          {nKind === "filter" && (
            <input
              value={nKeywords}
              onChange={(e) => setNKeywords(e.target.value)}
              placeholder="Mots-clés du mapping auto (ex. burger, hamburger)"
              className="border-border-strong bg-surface h-9 w-full rounded-[10px] border px-2.5 text-xs"
            />
          )}
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
                  kind: nKind,
                  keywords: nKeywords,
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
                  {c.code}
                  {c.kind === "filter" ? (
                    <>
                      {" "}
                      · FILTRE ÉDITORIAL · {c.links} commerçant
                      {c.links > 1 ? "s" : ""} lié{c.links > 1 ? "s" : ""}
                    </>
                  ) : (
                    <>
                      {" "}
                      · {c.merchants} commerçant
                      {c.merchants > 1 ? "s" : ""}
                      {c.links > 0 ? ` · ${c.links} en secondaire` : ""}
                    </>
                  )}
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

              {/* Renommage : libellés FR/AR + emoji (le code est immuable). */}
              <button
                type="button"
                disabled={busy}
                title="Renommer (libellés FR/AR + emoji)"
                onClick={() => openEdit(c)}
                className={
                  "shrink-0 rounded-[10px] border p-2 disabled:opacity-50 " +
                  (editCode === c.code
                    ? "border-primary-400 bg-primary-50 text-primary-700"
                    : "border-border bg-surface-2 text-muted hover:text-foreground")
                }
              >
                <Pencil className="size-4" />
              </button>

              {/* Mapping (filtres éditoriaux) : mots-clés + commerçants liés */}
              {c.kind === "filter" && (
                <button
                  type="button"
                  onClick={() =>
                    setOpenPanel(openPanel === c.code ? null : c.code)
                  }
                  className={
                    "shrink-0 rounded-[10px] border px-3 py-1.5 text-xs font-semibold " +
                    (openPanel === c.code
                      ? "border-primary-400 bg-primary-50 text-primary-700"
                      : "border-border bg-surface-2")
                  }
                >
                  Mapping
                </button>
              )}

              {/* Suppression : un TYPE utilisé (principal OU secondaire) est
                  insupprimable ; un filtre éditorial part avec son mapping. */}
              <button
                type="button"
                disabled={
                  busy ||
                  (c.kind !== "filter" && (c.merchants > 0 || c.links > 0))
                }
                title={
                  c.kind !== "filter" && (c.merchants > 0 || c.links > 0)
                    ? "Des commerçants utilisent cette catégorie (principale ou secondaire) — masquez-la."
                    : "Supprimer la catégorie"
                }
                onClick={() => run(c.code, () => deleteCategory(c.code))}
                className="text-danger-600 hover:bg-danger-50 shrink-0 rounded-[10px] p-2 disabled:opacity-30"
              >
                <Trash2 className="size-4" />
              </button>

              {editCode === c.code && (
                <div className="border-border bg-surface-2 w-full space-y-2 rounded-[12px] border p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <input
                      value={eLabel}
                      onChange={(e) => setELabel(e.target.value)}
                      placeholder="Libellé FR"
                      className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
                    />
                    <input
                      value={eLabelAr}
                      onChange={(e) => setELabelAr(e.target.value)}
                      placeholder="Libellé AR"
                      dir="rtl"
                      className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
                    />
                    <input
                      value={eEmoji}
                      onChange={(e) => setEEmoji(e.target.value)}
                      placeholder="Emoji"
                      className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs"
                    />
                  </div>
                  <p className="text-subtle text-[11px]">
                    Le nouveau libellé s&apos;applique partout (inscription,
                    filtres, vitrines) — le code technique « {c.code} » ne
                    change pas.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => saveLabels(c.code)}
                      className="bg-primary-600 rounded-[10px] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {busy ? "Enregistrement…" : "Enregistrer"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditCode(null)}
                      className="text-muted hover:text-foreground text-xs font-semibold underline"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              {openPanel === c.code && c.kind === "filter" && (
                <div className="w-full">
                  <FilterMappingPanel
                    code={c.code}
                    initialKeywords={c.keywords.join(", ")}
                    onDone={() => router.refresh()}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
  initialKeywords,
  onDone,
}: {
  code: string;
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
    <div className="border-border bg-surface-2 mt-2 space-y-2.5 rounded-[12px] border p-3">
      {/* Mots-clés + recalcul auto */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="Mots-clés auto (ex. burger, hamburger)"
          className="border-border-strong bg-surface h-9 min-w-0 flex-1 rounded-[10px] border px-2.5 text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => setCategoryKeywords(code, kw))}
          className="border-border bg-surface rounded-[10px] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          Enregistrer
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => recomputeAutoLinks(code))}
          className="bg-primary-600 rounded-[10px] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          Recalculer auto
        </button>
      </div>
      <p className="text-subtle text-[11px]">
        Le recalcul lie les commerçants dont les produits, tags ou le nom
        contiennent un mot-clé — sans toucher aux liaisons manuelles.
      </p>

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
          className="border-border-strong bg-surface h-9 min-w-0 flex-1 rounded-[10px] border px-2.5 text-xs"
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

      {/* Commerçants liés */}
      {rows.length === 0 ? (
        <p className="text-muted text-xs">
          Aucun commerçant lié — ajoutez des mots-clés puis « Recalculer auto »,
          ou liez manuellement.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li
              key={r.merchantId}
              className="border-border bg-surface inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
            >
              {r.name}
              <span className="text-subtle">
                ({SOURCE_LABEL[r.source] ?? r.source})
              </span>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
