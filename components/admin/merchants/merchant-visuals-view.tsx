"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ImageOff,
  ImagePlus,
  Loader2,
  Search,
  Sparkles,
  Store,
  Trash2,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { useConfirm } from "@/components/ui/confirm";
import type { BankImage, MerchantVisualRow } from "@/lib/data/admin-visuals";
import {
  addBankImage,
  autoAssignCover,
  autoAssignMissingCovers,
  disableBankImage,
  setMerchantVisual,
} from "@/app/admin/merchants/visuels/actions";

// =============================================================================
// Commerçants > Visuels — vue interactive :
//   1. bandeau d'état (sans couverture / sans logo) + attribution auto GLOBALE ;
//   2. liste des commerçants (recherche) → éditeur du sélectionné : aperçu de
//      la couverture AU CADRAGE RÉEL de la fiche client (même crop Cloudinary,
//      jamais de zoom trompeur), logo, URL manuelles, bouton « Auto » ;
//   3. banque d'images HD filtrée par catégorie (clic = définir la couverture),
//      ajout par URL (validée serveur) et retrait doux.
// Messages INLINE près de chaque action (règle produit : pas de toasts).
// =============================================================================

type Cat = { code: string; label: string };
type Msg = { text: string; tone: "ok" | "err" } | null;

export function MerchantVisualsView({
  bank,
  merchants,
  categories,
}: {
  bank: BankImage[];
  merchants: MerchantVisualRow[];
  categories: Cat[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, start] = useTransition();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    merchants[0]?.id ?? null
  );
  const [bankFilter, setBankFilter] = useState<"cat" | "all" | "generic">(
    "cat"
  );
  // Messages inline par zone (bandeau global / éditeur / banque).
  const [globalMsg, setGlobalMsg] = useState<Msg>(null);
  const [editorMsg, setEditorMsg] = useState<Msg>(null);
  const [bankMsg, setBankMsg] = useState<Msg>(null);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [logoUrlInput, setLogoUrlInput] = useState("");

  const catLabel = useMemo(() => {
    const m = new Map(categories.map((c) => [c.code, c.label]));
    return (code: string | null) =>
      code ? (m.get(code) ?? code) : "Sans catégorie";
  }, [categories]);

  const selected = merchants.find((m) => m.id === selectedId) ?? null;
  const missingCover = merchants.filter((m) => !m.cover_url).length;
  const missingLogo = merchants.filter((m) => !m.logo_url).length;

  const filteredMerchants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.commune ?? "").toLowerCase().includes(q) ||
        catLabel(m.category).toLowerCase().includes(q)
    );
  }, [merchants, query, catLabel]);

  const visibleBank = useMemo(() => {
    if (bankFilter === "all") return bank;
    if (bankFilter === "generic") return bank.filter((b) => !b.category);
    // « Sa catégorie » : visuels de la catégorie du sélectionné + génériques.
    const cat = selected?.category ?? null;
    return bank.filter((b) => b.category === cat || b.category === null);
  }, [bank, bankFilter, selected]);

  const run = (
    fn: () => Promise<{ error?: string; ok?: boolean; count?: number }>,
    setMsg: (m: Msg) => void,
    okText: (count?: number) => string
  ) =>
    start(async () => {
      setMsg(null);
      const res = await fn();
      if (res.error) setMsg({ text: res.error, tone: "err" });
      else {
        setMsg({ text: okText(res.count), tone: "ok" });
        router.refresh();
      }
    });

  return (
    <div className="space-y-5">
      {/* ───── 1. ÉTAT GLOBAL + AUTO EN MASSE ───── */}
      <section className="border-border bg-surface rounded-lg border p-4 lg:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground text-base font-bold">
              Qualité visuelle de la marketplace
            </h2>
            <p className="text-muted mt-0.5 text-sm">
              {merchants.length} commerçant{merchants.length > 1 ? "s" : ""} ·{" "}
              <span
                className={
                  missingCover > 0 ? "text-warning-700 font-semibold" : ""
                }
              >
                {missingCover} sans couverture
              </span>{" "}
              ·{" "}
              <span
                className={
                  missingLogo > 0 ? "text-warning-700 font-semibold" : ""
                }
              >
                {missingLogo} sans logo
              </span>
            </p>
          </div>
          <button
            type="button"
            disabled={busy || missingCover === 0}
            onClick={() =>
              run(
                autoAssignMissingCovers,
                setGlobalMsg,
                (c) => `${c ?? 0} couverture(s) attribuée(s) automatiquement.`
              )
            }
            className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Couvertures auto ({missingCover})
          </button>
        </div>
        <InlineMsg msg={globalMsg} />
        <p className="text-subtle mt-2 text-xs">
          L&apos;attribution automatique choisit un visuel HD de la banque selon
          la catégorie du commerçant, sans jamais écraser une photo existante.
        </p>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
        {/* ───── 2a. LISTE DES COMMERÇANTS ───── */}
        <section className="border-border bg-surface rounded-lg border">
          <div className="border-border border-b p-3">
            <div className="bg-surface-2 flex h-9 items-center gap-2 rounded-full px-3">
              <Search className="text-muted size-4 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom, commune, catégorie…"
                className="placeholder:text-hint text-foreground w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>
          <ul className="max-h-[520px] overflow-y-auto p-1.5">
            {filteredMerchants.length === 0 && (
              <li className="text-muted px-3 py-6 text-center text-sm">
                Aucun commerçant ne correspond.
              </li>
            )}
            {filteredMerchants.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(m.id);
                    setEditorMsg(null);
                    setCoverUrlInput("");
                    setLogoUrlInput("");
                    setBankFilter("cat");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors",
                    m.id === selectedId ? "bg-primary-50" : "hover:bg-surface-2"
                  )}
                >
                  {m.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        cldUrl(m.logo_url, {
                          width: 80,
                          height: 80,
                          crop: "fill",
                          gravity: "auto",
                        }) ?? m.logo_url
                      }
                      alt=""
                      loading="lazy"
                      className="rounded-control size-9 shrink-0 bg-white object-cover ring-1 ring-black/5"
                    />
                  ) : (
                    <span className="bg-surface-3 text-muted rounded-control grid size-9 shrink-0 place-items-center">
                      <Store className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-semibold">
                      {m.name}
                    </span>
                    <span className="text-muted block truncate text-xs">
                      {catLabel(m.category)}
                      {m.commune ? ` · ${m.commune}` : ""}
                    </span>
                  </span>
                  {!m.cover_url && (
                    <span
                      title="Sans couverture"
                      className="bg-warning-500 size-2 shrink-0 rounded-full"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ───── 2b. ÉDITEUR DU SÉLECTIONNÉ + 3. BANQUE ───── */}
        <div className="space-y-4">
          {selected ? (
            <section className="border-border bg-surface rounded-lg border p-4 lg:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-foreground text-base font-bold">
                  {selected.name}
                  <span className="text-muted ms-2 text-sm font-medium">
                    {catLabel(selected.category)}
                  </span>
                </h2>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => autoAssignCover(selected.id),
                      setEditorMsg,
                      () => "Couverture attribuée selon la catégorie."
                    )
                  }
                  className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                >
                  <Wand2 className="size-3.5" />
                  Auto (catégorie)
                </button>
              </div>

              {/* Aperçu couverture AU CADRAGE RÉEL de la fiche client (même
                  ratio ~3:1 et même crop Cloudinary gravity auto). */}
              <div className="bg-surface-3 rounded-card-lg relative mt-3 h-[120px] overflow-hidden">
                {selected.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      cldUrl(selected.cover_url, {
                        width: 1200,
                        height: 408,
                        crop: "fill",
                        gravity: "auto",
                      }) ?? selected.cover_url
                    }
                    alt="Aperçu couverture"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-muted flex h-full flex-col items-center justify-center gap-1 text-xs">
                    <ImageOff className="size-5" />
                    Aucune couverture — la fiche affiche l&apos;image de
                    catégorie par défaut.
                  </div>
                )}
                <span className="text-micro absolute start-2 bottom-1.5 rounded-full bg-black/55 px-2 py-0.5 font-semibold text-white">
                  Aperçu au cadrage réel de la fiche
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {/* Couverture par URL */}
                <div>
                  <label className="text-muted text-xs font-bold uppercase">
                    Couverture par URL
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      type="url"
                      value={coverUrlInput}
                      onChange={(e) => setCoverUrlInput(e.target.value)}
                      placeholder="https://…"
                      className="border-border bg-surface-2 text-foreground placeholder:text-hint rounded-control h-9 w-full min-w-0 border px-2.5 text-sm outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || !coverUrlInput.trim()}
                      onClick={() =>
                        run(
                          () =>
                            setMerchantVisual(
                              selected.id,
                              "cover",
                              coverUrlInput
                            ),
                          setEditorMsg,
                          () => "Couverture mise à jour."
                        )
                      }
                      className="bg-primary-600 hover:bg-primary-700 rounded-control h-9 shrink-0 px-3 text-xs font-bold text-white disabled:opacity-50"
                    >
                      Appliquer
                    </button>
                  </div>
                  {selected.cover_url && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => setMerchantVisual(selected.id, "cover", null),
                          setEditorMsg,
                          () => "Couverture retirée."
                        )
                      }
                      className="text-danger-600 mt-1 text-xs font-semibold hover:underline disabled:opacity-50"
                    >
                      Retirer la couverture
                    </button>
                  )}
                </div>

                {/* Logo par URL */}
                <div>
                  <label className="text-muted text-xs font-bold uppercase">
                    Logo par URL
                  </label>
                  <div className="mt-1 flex items-center gap-1.5">
                    {selected.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          cldUrl(selected.logo_url, {
                            width: 96,
                            height: 96,
                            crop: "fill",
                            gravity: "auto",
                          }) ?? selected.logo_url
                        }
                        alt="Logo"
                        className="rounded-control size-9 shrink-0 bg-white object-cover ring-1 ring-black/5"
                      />
                    ) : (
                      <span className="bg-surface-3 text-muted rounded-control grid size-9 shrink-0 place-items-center">
                        <Store className="size-4" />
                      </span>
                    )}
                    <input
                      type="url"
                      value={logoUrlInput}
                      onChange={(e) => setLogoUrlInput(e.target.value)}
                      placeholder="https://…"
                      className="border-border bg-surface-2 text-foreground placeholder:text-hint rounded-control h-9 w-full min-w-0 border px-2.5 text-sm outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || !logoUrlInput.trim()}
                      onClick={() =>
                        run(
                          () =>
                            setMerchantVisual(
                              selected.id,
                              "logo",
                              logoUrlInput
                            ),
                          setEditorMsg,
                          () => "Logo mis à jour."
                        )
                      }
                      className="bg-primary-600 hover:bg-primary-700 rounded-control h-9 shrink-0 px-3 text-xs font-bold text-white disabled:opacity-50"
                    >
                      Appliquer
                    </button>
                  </div>
                  {selected.logo_url && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => setMerchantVisual(selected.id, "logo", null),
                          setEditorMsg,
                          () => "Logo retiré."
                        )
                      }
                      className="text-danger-600 mt-1 text-xs font-semibold hover:underline disabled:opacity-50"
                    >
                      Retirer le logo
                    </button>
                  )}
                </div>
              </div>
              <InlineMsg msg={editorMsg} />
            </section>
          ) : (
            <section className="border-border bg-surface text-muted rounded-lg border p-8 text-center text-sm">
              Sélectionnez un commerçant pour gérer ses visuels.
            </section>
          )}

          {/* ───── 3. BANQUE D'IMAGES ───── */}
          <section className="border-border bg-surface rounded-lg border p-4 lg:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-foreground text-base font-bold">
                Banque d&apos;images HD
                <span className="text-muted ms-2 text-sm font-medium">
                  {visibleBank.length} visuel{visibleBank.length > 1 ? "s" : ""}
                </span>
              </h2>
              <div className="bg-surface-2 inline-flex rounded-full p-0.5 text-xs font-bold">
                {(
                  [
                    ["cat", "Sa catégorie"],
                    ["all", "Toutes"],
                    ["generic", "Génériques"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBankFilter(key)}
                    className={cn(
                      "rounded-full px-3 py-1 transition-colors",
                      bankFilter === key
                        ? "text-foreground bg-white"
                        : "text-muted hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-subtle mt-1 text-xs">
              Cliquez un visuel pour le définir comme couverture
              {selected ? ` de ${selected.name}` : ""} — photos 2400 px,
              recadrées automatiquement au format fiche sans perte de qualité.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleBank.map((img) => (
                <figure key={img.id} className="group relative">
                  <button
                    type="button"
                    disabled={busy || !selected}
                    title={
                      selected
                        ? `Définir comme couverture de ${selected.name}`
                        : "Sélectionnez d'abord un commerçant"
                    }
                    onClick={() =>
                      selected &&
                      run(
                        () => setMerchantVisual(selected.id, "cover", img.url),
                        setEditorMsg,
                        () => `Couverture « ${img.label} » appliquée.`
                      )
                    }
                    className="focus-visible:ring-primary-500 block w-full overflow-hidden rounded-md ring-2 ring-transparent transition-shadow disabled:cursor-not-allowed"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        cldUrl(img.url, {
                          width: 520,
                          height: 180,
                          crop: "fill",
                          gravity: "auto",
                        }) ?? img.url
                      }
                      alt={img.label}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[3/1.05] w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                    {selected?.cover_url === img.url && (
                      <span className="bg-success-600 absolute start-1.5 top-1.5 grid size-5 place-items-center rounded-full text-white">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                  <figcaption className="text-muted text-caption mt-1 flex items-center justify-between gap-1">
                    <span className="truncate font-medium">
                      {img.label}
                      <span className="text-subtle">
                        {" "}
                        · {img.category ? catLabel(img.category) : "Générique"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      title="Retirer de la banque"
                      onClick={async () => {
                        const okGo = await confirm({
                          title: "Retirer ce visuel de la banque ?",
                          message:
                            "Les commerçants qui l'utilisent déjà gardent leur couverture.",
                          confirmLabel: "Retirer",
                          danger: true,
                        });
                        if (okGo) {
                          run(
                            () => disableBankImage(img.id),
                            setBankMsg,
                            () => "Visuel retiré de la banque."
                          );
                        }
                      }}
                      className="text-subtle hover:text-danger-600 shrink-0 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </figcaption>
                </figure>
              ))}
              {visibleBank.length === 0 && (
                <p className="text-muted col-span-full py-6 text-center text-sm">
                  Aucun visuel pour ce filtre.
                </p>
              )}
            </div>

            {/* Ajout à la banque */}
            <AddBankImageForm
              categories={categories}
              busy={busy}
              onSubmit={(input) =>
                run(
                  () => addBankImage(input),
                  setBankMsg,
                  () => "Visuel ajouté à la banque."
                )
              }
            />
            <InlineMsg msg={bankMsg} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Message inline (succès vert / erreur rouge) sous la zone d'action. */
function InlineMsg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p
      className={cn(
        "mt-2 text-sm font-medium",
        msg.tone === "ok" ? "text-success-700" : "text-danger-600"
      )}
    >
      {msg.text}
    </p>
  );
}

/** Formulaire d'ajout d'un visuel à la banque (URL validée côté serveur :
 *  l'image doit exister ET être une image). */
function AddBankImageForm({
  categories,
  busy,
  onSubmit,
}: {
  categories: Cat[];
  busy: boolean;
  onSubmit: (input: {
    category: string | null;
    label: string;
    url: string;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [url, setUrl] = useState("");
  const canSubmit = label.trim() && url.trim() && !busy;

  return (
    <div className="border-border mt-4 border-t pt-4">
      <p className="text-muted text-xs font-bold uppercase">
        Ajouter un visuel à la banque
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-[1fr_180px_1fr_auto]">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Libellé (ex. Vitrine pâtisserie)"
          maxLength={80}
          className="border-border bg-surface-2 text-foreground placeholder:text-hint rounded-control h-9 border px-2.5 text-sm outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border-border bg-surface-2 text-foreground rounded-control h-9 border px-2 text-sm outline-none"
        >
          <option value="">Générique (toutes)</option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (photo haute résolution)"
          className="border-border bg-surface-2 text-foreground placeholder:text-hint rounded-control h-9 border px-2.5 text-sm outline-none"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            onSubmit({ category: category || null, label, url });
            setLabel("");
            setUrl("");
          }}
          className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex h-9 items-center gap-1.5 px-3 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          Ajouter
        </button>
      </div>
      <p className="text-subtle mt-1.5 text-xs">
        Privilégiez des photos ≥ 2000 px de large, nettes et lumineuses —
        l&apos;URL est vérifiée (image réelle) avant l&apos;ajout.
      </p>
    </div>
  );
}
