"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Download,
  ImagePlus,
  Layers,
  Loader2,
  Printer,
  Search,
  Store,
  Trash2,
  Undo2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleRow } from "@/components/ui/toggle";
import { ActionButton } from "@/components/ui/action-button";
import { useConfirm } from "@/components/ui/confirm";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/native/download-file";
import { LOYALTY_CARD } from "@/lib/design/tokens";
import {
  CARD_TEMPLATES,
  DEFAULT_TEMPLATE_KEY,
  cardBgAssetPath,
  cardLogoAssetPath,
  getCardTemplate,
  type CardTemplate,
} from "@/lib/loyalty/card-templates";
import {
  adminBlockLoyaltyBatch,
  adminCreateLoyaltyBatch,
  adminDeleteLoyaltyBatch,
  adminListLoyaltyBatches,
  adminUnblockLoyaltyBatch,
  type CreateBatchResult,
  type LoyaltyMerchantHit,
} from "@/app/admin/merchants/fidelite/actions";
import {
  LoyaltyMerchantPicker,
  RemoteProgramPanel,
} from "@/components/admin/merchants/loyalty-merchant-picker";

export type LoyaltyBatchRow = {
  id: string;
  created_at: string;
  /** NULL = lot GÉNÉRIQUE Coligo (0459), valable chez tous les commerçants. */
  merchant_id: string | null;
  merchant_name: string | null;
  template_key: string;
  quantity: number;
  note: string | null;
  created_by_email: string | null;
  print_merchant_name: boolean;
  /** Cartes nées « activated » (0460) — utilisables en caisse sans compte. */
  pre_activated: boolean;
  /** Visuel recto/verso fourni par l'équipe Coligo (0461). */
  has_custom_art: boolean;
  /** Suppression DOUCE (0461) : lot conservé, cartes toutes bloquées. */
  deleted_at: string | null;
  printed: number;
  activated: number;
  linked: number;
  blocked: number;
  /** Options d'impression v2 (0462) : titre FR+AR, logo commerçant, mention. */
  print_title: boolean;
  print_merchant_logo: boolean;
  print_valid_all: boolean;
};

const initial: CreateBatchResult = {};

function dayFr(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${d.getFullYear()}`;
}

const pdfHref = (batchId: string) => `/api/pdf/cartes-fidelite/${batchId}`;

/** Téléchargement DIRECT du PDF (helper natif) : fiable navigateur ET WebView
 *  Capacitor — plus jamais la redirection vers l'app au clic. État local. */
function PdfDownloadButton({
  batchId,
  className,
  label = "PDF",
}: {
  batchId: string;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        const r = await downloadFile(
          pdfHref(batchId),
          `cartes-fidelite-${batchId.slice(0, 8)}.pdf`
        );
        if (!r.ok) setFailed(true);
        setBusy(false);
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-md text-xs font-bold disabled:opacity-60",
        failed
          ? "border-danger-300 text-danger-700 border px-2.5 py-1.5"
          : "border-border hover:bg-surface-2 border px-2.5 py-1.5",
        className
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      {failed ? "Réessayer" : label}
    </button>
  );
}

/** Aperçu miniature d'un modèle — MÊME PNG de fond que le PDF (source visuelle
 *  unique) : réplique du RECTO v2 (titre italique FR+AR, logo commerçant sur
 *  socle blanc, mention basse), fidèle aux options cochées. */
function TemplatePreview({
  tpl,
  merchantName,
  showTitle,
  showLogo,
  showValidAll,
}: {
  tpl: CardTemplate;
  merchantName: string;
  showTitle: boolean;
  showLogo: boolean;
  showValidAll: boolean;
}) {
  return (
    <div
      className="relative flex aspect-[856/540] w-full flex-col justify-between overflow-hidden rounded-md border p-1.5"
      style={{
        backgroundImage: `url(${cardBgAssetPath(tpl.key)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        borderColor: tpl.g2,
        color: tpl.text,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardLogoAssetPath(tpl)}
          alt=""
          className="h-3.5 w-auto"
          loading="lazy"
        />
        {showLogo && (
          <span
            className="flex size-4 items-center justify-center rounded-[3px]"
            style={{ background: LOYALTY_CARD.paper }}
            aria-hidden
          >
            <Store className="size-2.5" style={{ color: LOYALTY_CARD.qrInk }} />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-1.5">
        <div className="shrink-0">
          {/* Faux QR : panneau blanc arrondi, encre violette (comme le PDF). */}
          <span
            className="block size-6 rounded-[3px]"
            style={{
              background: LOYALTY_CARD.paper,
              backgroundImage: `repeating-linear-gradient(0deg,${LOYALTY_CARD.qrInk} 0 1px,transparent 1px 2px),repeating-linear-gradient(90deg,${LOYALTY_CARD.qrInk} 0 1px,transparent 1px 2px)`,
              backgroundSize: "70% 70%",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
            aria-hidden
          />
          <p className="mt-0.5 font-mono text-[4.5px] font-bold tracking-widest">
            AB3F 9K72 4C6D
          </p>
        </div>
        <div className="min-w-0 flex-1 text-end">
          {showTitle && (
            <>
              <p className="text-[7px] leading-none font-black tracking-tight italic">
                CARTE DE FIDÉLITÉ
              </p>
              <p className="text-[5px] leading-tight italic">بطاقة الوفاء</p>
            </>
          )}
          {merchantName && (
            <>
              <p
                className="mt-0.5 text-[4px] tracking-widest"
                style={{ color: tpl.subtext }}
              >
                CHEZ
              </p>
              <p className="truncate text-[6.5px] leading-tight font-black">
                {merchantName}
              </p>
            </>
          )}
          {showValidAll && (
            <p className="mt-0.5 text-[4px] leading-none italic">
              Carte valable chez tous les commerçants
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Console de génération des LOTS de cartes : choix du commerçant, du MODÈLE
 * VISUEL (aperçus = mêmes fonds que le PDF) ou d'un VISUEL PERSONNALISÉ
 * recto/verso (0461), quantité bornée, puis PDF d'impression retéléchargeable
 * À TOUT MOMENT depuis le journal (régénéré à la volée, jamais stocké).
 * Journal : recherche serveur, blocage/déblocage/suppression du LOT ENTIER.
 */
export function LoyaltyCardsConsole({
  batches,
  maxBatch,
}: {
  batches: LoyaltyBatchRow[];
  maxBatch: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [state, action, pending] = useActionState(
    adminCreateLoyaltyBatch,
    initial
  );
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  // Recherche d'abord (règle annuaires) : aucun chargement en masse.
  const [selected, setSelected] = useState<LoyaltyMerchantHit | null>(null);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_KEY);
  // Options d'impression/usage (0459/0460/0462) — défauts propriétaire : nom
  // et logo imprimés quand un commerçant est choisi, titre affiché, cartes
  // PRÉ-ACTIVÉES ; mention « valable partout » = suit le type de lot tant que
  // l'admin n'y a pas touché (générique → oui, commerçant → non).
  const [printName, setPrintName] = useState(true);
  const [printTitle, setPrintTitle] = useState(true);
  const [printLogo, setPrintLogo] = useState(true);
  const [validAll, setValidAll] = useState<boolean | null>(null);
  const [preActivated, setPreActivated] = useState(true);
  const [hasArtRecto, setHasArtRecto] = useState(false);
  const merchantName = selected && printName ? selected.name : "";
  const validAllOn = validAll ?? !selected;
  const printLogoOn = !!selected && printLogo;

  // Journal : recherche SERVEUR débouncée (ilike nom / note / n° / générique).
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LoyaltyBatchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const id = window.setTimeout(async () => {
      const rows = await adminListLoyaltyBatches(q);
      if (searchSeq.current === seq) {
        setResults(rows);
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [query]);

  // Opérations de lot : état LOCAL par ligne (jamais un verrou global).
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runBatchOp(
    b: LoyaltyBatchRow,
    op: "block" | "unblock" | "delete"
  ) {
    const label = b.merchant_name ?? "cartes génériques";
    const confirmed = await confirm(
      op === "delete"
        ? {
            title: `Supprimer le lot (${label}, ${b.quantity} cartes) ?`,
            message:
              "Toutes les cartes de la série sont désactivées immédiatement. Le lot reste consultable dans le journal (traçabilité).",
            confirmLabel: "Supprimer le lot",
            danger: true,
          }
        : op === "block"
          ? {
              title: `Bloquer les cartes du lot (${label}) ?`,
              message: `${b.quantity - b.blocked} carte(s) seront refusées en caisse jusqu'au déblocage.`,
              confirmLabel: "Bloquer",
              danger: true,
            }
          : {
              title: `Débloquer les cartes du lot (${label}) ?`,
              message: `${b.blocked} carte(s) retrouvent leur état d'avant blocage.`,
              confirmLabel: "Débloquer",
            }
    );
    if (!confirmed) return;
    setRowBusy(`${b.id}:${op}`);
    setRowError(null);
    const r =
      op === "delete"
        ? await adminDeleteLoyaltyBatch(b.id)
        : op === "block"
          ? await adminBlockLoyaltyBatch(b.id)
          : await adminUnblockLoyaltyBatch(b.id);
    setRowBusy(null);
    if (!r.ok) {
      setRowError(
        r.reason === "deleted"
          ? "Lot supprimé : déblocage impossible."
          : "Opération impossible. Réessayez."
      );
      return;
    }
    router.refresh();
    if (query.trim()) setResults(await adminListLoyaltyBatches(query));
  }

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const shown = results ?? batches;

  return (
    <section className="space-y-4">
      <form
        action={action}
        className="border-border bg-surface space-y-4 rounded-lg border p-4"
      >
        <p className="flex items-center gap-2 text-sm font-bold">
          <Printer className="text-primary-600 size-4" />
          Générer un lot de cartes
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Commerçant (optionnel)</Label>
            <input
              type="hidden"
              name="merchant_id"
              value={selected?.id ?? ""}
            />
            <LoyaltyMerchantPicker selected={selected} onSelect={setSelected} />
            <p className="text-subtle text-xs">
              Sans commerçant : cartes GÉNÉRIQUES Coligo, valables chez tous.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantité</Label>
            <Input
              id="quantity"
              name="quantity"
              inputMode="numeric"
              defaultValue="50"
              disabled={pending}
            />
            <p className="text-subtle text-xs">Max {maxBatch} par lot.</p>
          </div>
        </div>

        <div className={cn("space-y-1.5", hasArtRecto && "opacity-50")}>
          <Label>Modèle visuel</Label>
          <input type="hidden" name="template_key" value={template} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_TEMPLATES.map((tplDef) => (
              <button
                key={tplDef.key}
                type="button"
                onClick={() => setTemplate(tplDef.key)}
                aria-pressed={template === tplDef.key}
                disabled={hasArtRecto}
                className={cn(
                  "rounded-md p-1.5 text-start transition",
                  template === tplDef.key
                    ? "ring-primary-500 bg-primary-50 ring-2"
                    : "hover:bg-surface-2"
                )}
              >
                <TemplatePreview
                  tpl={tplDef}
                  merchantName={merchantName}
                  showTitle={printTitle}
                  showLogo={printLogoOn}
                  showValidAll={validAllOn}
                />
                <p className="mt-1.5 text-xs font-bold">{tplDef.label}</p>
                <p className="text-subtle text-caption leading-tight">
                  {tplDef.desc}
                </p>
              </button>
            ))}
          </div>
          {hasArtRecto && (
            <p className="text-subtle text-xs">
              Modèle ignoré : le lot utilisera votre visuel personnalisé.
            </p>
          )}
        </div>

        {/* DESIGN PERSONNALISÉ (0461) : recto/verso fournis, fond perdu compris.
            Le système ne pose alors QUE le QR + le numéro sur le recto. */}
        <div className="border-border space-y-3 rounded-md border p-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            <ImagePlus className="text-primary-600 size-4" />
            Visuel personnalisé (optionnel)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="art_recto">Recto (PNG/JPG)</Label>
              <input
                id="art_recto"
                name="art_recto"
                type="file"
                accept="image/png,image/jpeg"
                disabled={pending}
                onChange={(e) =>
                  setHasArtRecto((e.target.files?.length ?? 0) > 0)
                }
                className="text-muted file:bg-primary-50 file:text-primary-700 block w-full text-xs file:me-3 file:rounded-md file:border-0 file:px-3 file:py-2 file:text-xs file:font-bold"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="art_verso">Verso (PNG/JPG)</Label>
              <input
                id="art_verso"
                name="art_verso"
                type="file"
                accept="image/png,image/jpeg"
                disabled={pending}
                className="text-muted file:bg-primary-50 file:text-primary-700 block w-full text-xs file:me-3 file:rounded-md file:border-0 file:px-3 file:py-2 file:text-xs file:font-bold"
              />
            </div>
          </div>
          <p className="text-subtle text-xs">
            Image COMPLÈTE de la carte, fonds perdus 3 mm compris (≥ 1082 × 709
            px, 8 Mo max). Le système n&apos;ajoute que le QR et le numéro sur
            le recto ; le verso est imprimé tel quel.
          </p>
        </div>

        {/* Options du lot (0459/0460/0462) — envoyées en champs cachés "1"/"". */}
        <input
          type="hidden"
          name="print_merchant_name"
          value={printName ? "1" : ""}
        />
        <input type="hidden" name="print_title" value={printTitle ? "1" : ""} />
        <input
          type="hidden"
          name="print_merchant_logo"
          value={printLogoOn ? "1" : ""}
        />
        <input
          type="hidden"
          name="print_valid_all"
          value={validAllOn ? "1" : ""}
        />
        <input
          type="hidden"
          name="pre_activated"
          value={preActivated ? "1" : ""}
        />
        <div className="border-border divide-border divide-y rounded-md border px-3">
          <ToggleRow
            title="Titre « CARTE DE FIDÉLITÉ »"
            description="Grand titre en italique + « بطاقة الوفاء » en dessous, sur le recto."
            checked={printTitle}
            onChange={setPrintTitle}
            disabled={pending}
          />
          <ToggleRow
            title="Imprimer « Chez … » sur la carte"
            description={
              selected
                ? `La carte affichera « Chez ${selected.name} » (branding seul — elle marche partout).`
                : "Choisissez un commerçant pour imprimer son nom."
            }
            checked={!!selected && printName}
            onChange={setPrintName}
            disabled={pending || !selected}
          />
          <ToggleRow
            title="Logo du commerçant sur la carte"
            description={
              selected
                ? "Le logo de sa fiche, posé sur un socle blanc en haut à droite — la carte devient la sienne. Sans logo sur la fiche, la carte sort sans."
                : "Choisissez un commerçant pour imprimer son logo."
            }
            checked={printLogoOn}
            onChange={setPrintLogo}
            disabled={pending || !selected}
          />
          <ToggleRow
            title="Mention « valable chez tous les commerçants »"
            description="Petite ligne en bas du recto. Cochée d'office pour les cartes génériques."
            checked={validAllOn}
            onChange={setValidAll}
            disabled={pending}
          />
          <ToggleRow
            title="Cartes pré-activées"
            description="Utilisables en caisse dès l'impression, sans compte ni application (personnes âgées). Décoché : activation au 1ᵉʳ crédit en caisse."
            checked={preActivated}
            onChange={setPreActivated}
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note (optionnel)</Label>
          <Input
            id="note"
            name="note"
            placeholder="Ex. 2ᵉ tirage — présentoir comptoir"
            disabled={pending}
          />
        </div>

        {state.error && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}
        {state.ok && state.batchId && (
          <div className="border-success-200 bg-success-50 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <p className="text-success-800 text-sm font-bold">
              {state.preActivated
                ? `Lot de ${state.quantity} cartes créé — PRÉ-ACTIVÉES, prêtes à l'emploi en caisse (sans valeur tant qu'aucun crédit n'est posé).`
                : `Lot de ${state.quantity} cartes créé — « imprimées », sans valeur avant activation en caisse.`}
            </p>
            <PdfDownloadButton
              batchId={state.batchId}
              label="Télécharger le PDF"
              className="bg-success-600 hover:bg-success-700 border-0 px-3 py-2 text-sm text-white"
            />
          </div>
        )}

        <ActionButton
          type="submit"
          state={fb}
          idleIcon={<Printer className="size-4" />}
          labels={{
            idle: "Générer le lot",
            pending: "Génération…",
            success: "Lot créé ✓",
          }}
        />
      </form>

      {/* Pilotage À DISTANCE : le programme du commerçant sélectionné, lisible
          et modifiable ici même (intervention rapide support). */}
      {selected && <RemoteProgramPanel merchant={selected} />}

      {/* Journal des lots : qui, quand, combien, pour quel commerçant —
          recherche SERVEUR + opérations sur le lot entier (0461). */}
      <div className="border-border bg-surface rounded-lg border">
        <div className="border-border flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Layers className="text-primary-600 size-4" />
            Journal des lots
          </p>
          <div className="relative ms-auto w-full sm:w-64">
            <Search className="text-subtle absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Commerçant, note, n° de lot…"
              className="h-9 ps-8 text-sm"
            />
          </div>
        </div>
        {rowError && (
          <p className="text-danger-600 border-border border-b px-4 py-2 text-sm">
            {rowError}
          </p>
        )}
        {searching && !results ? (
          <p className="text-muted px-4 py-6 text-center text-sm">Recherche…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted px-4 py-6 text-center text-sm">
            {query.trim()
              ? "Aucun lot ne correspond."
              : "Aucun lot généré pour l'instant."}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {shown.map((b) => {
              const tpl = getCardTemplate(b.template_key);
              const deleted = !!b.deleted_at;
              return (
                <li
                  key={b.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
                    deleted && "opacity-60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {b.merchant_name ?? "Cartes génériques Coligo"}
                      <span className="text-muted font-medium">
                        {" "}
                        · {b.quantity} cartes
                      </span>
                      {deleted && (
                        <span className="bg-danger-50 text-danger-700 ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          supprimé
                        </span>
                      )}
                      {!deleted && b.blocked === b.quantity && (
                        <span className="bg-danger-50 text-danger-700 ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          bloqué
                        </span>
                      )}
                      {b.has_custom_art && (
                        <span className="bg-primary-50 text-primary-700 ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          design perso
                        </span>
                      )}
                      {b.pre_activated && (
                        <span className="bg-success-50 text-success-700 ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          pré-activées
                        </span>
                      )}
                      {b.merchant_name && !b.print_merchant_name && (
                        <span className="bg-surface-2 text-muted ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          sans nom imprimé
                        </span>
                      )}
                      {b.print_merchant_logo && (
                        <span className="bg-primary-50 text-primary-700 ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                          logo imprimé
                        </span>
                      )}
                    </p>
                    <p className="text-subtle text-xs">
                      {dayFr(b.created_at)}
                      {b.created_by_email ? ` · ${b.created_by_email}` : ""}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  {!b.has_custom_art && (
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className="size-3 rounded-full border"
                        style={{
                          backgroundImage: `linear-gradient(135deg, ${tpl.g1}, ${tpl.g3})`,
                          borderColor: tpl.g2,
                        }}
                        aria-hidden
                      />
                      {tpl.label}
                    </span>
                  )}
                  <span className="text-muted text-xs tabular-nums">
                    {b.printed} à distribuer · {b.activated} activées ·{" "}
                    {b.linked} liées
                    {b.blocked > 0 ? ` · ${b.blocked} bloquées` : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <PdfDownloadButton batchId={b.id} />
                    {!deleted && b.blocked < b.quantity && (
                      <button
                        type="button"
                        disabled={rowBusy === `${b.id}:block`}
                        onClick={() => void runBatchOp(b, "block")}
                        className="border-border text-danger-700 hover:bg-danger-50 flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-bold disabled:opacity-60"
                      >
                        {rowBusy === `${b.id}:block` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Ban className="size-3.5" />
                        )}
                        Bloquer
                      </button>
                    )}
                    {!deleted && b.blocked > 0 && (
                      <button
                        type="button"
                        disabled={rowBusy === `${b.id}:unblock`}
                        onClick={() => void runBatchOp(b, "unblock")}
                        className="border-border hover:bg-surface-2 flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-bold disabled:opacity-60"
                      >
                        {rowBusy === `${b.id}:unblock` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="size-3.5" />
                        )}
                        Débloquer
                      </button>
                    )}
                    {!deleted && (
                      <button
                        type="button"
                        disabled={rowBusy === `${b.id}:delete`}
                        onClick={() => void runBatchOp(b, "delete")}
                        aria-label="Supprimer le lot"
                        className="border-border text-danger-700 hover:bg-danger-50 flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-bold disabled:opacity-60"
                      >
                        {rowBusy === `${b.id}:delete` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
