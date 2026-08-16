"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Layers, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { cn } from "@/lib/utils";
import {
  CARD_TEMPLATES,
  CARD_WAVE_BACK,
  CARD_WAVE_FRONT,
  DEFAULT_TEMPLATE_KEY,
  getCardTemplate,
} from "@/lib/loyalty/card-templates";
import { LOYALTY_CARD } from "@/lib/design/tokens";
import {
  adminCreateLoyaltyBatch,
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
  merchant_id: string;
  merchant_name: string;
  template_key: string;
  quantity: number;
  note: string | null;
  created_by_email: string | null;
  printed: number;
  activated: number;
  linked: number;
  blocked: number;
};

const initial: CreateBatchResult = {};

function dayFr(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${d.getFullYear()}`;
}

const pdfHref = (batchId: string) => `/api/pdf/cartes-fidelite/${batchId}`;

/** Aperçu miniature d'un modèle (mêmes teintes que le PDF — source unique). */
function TemplatePreview({
  templateKey,
  merchantName,
}: {
  templateKey: string;
  merchantName: string;
}) {
  const tpl = getCardTemplate(templateKey);
  return (
    <div
      className="relative flex aspect-[856/540] w-full flex-col justify-between overflow-hidden rounded-md border p-2"
      style={{ background: tpl.bg, borderColor: tpl.accent }}
    >
      {/* Vagues du bas — MÊMES tracés que le PDF (source unique). */}
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-1/2 w-full"
        aria-hidden
      >
        <path d={CARD_WAVE_BACK} fill={tpl.text} opacity={0.08} />
        <path d={CARD_WAVE_FRONT} fill={tpl.accent} />
      </svg>
      <div className="relative z-10 flex items-start justify-between">
        <span
          className="text-micro leading-none font-black"
          style={{ color: tpl.text }}
        >
          Coligo
        </span>
        {/* Faux QR d'aperçu (teintes = tokens LOYALTY_CARD, comme le PDF). */}
        <span
          className="size-5 rounded-xs"
          style={{
            background: LOYALTY_CARD.paper,
            backgroundImage: `repeating-linear-gradient(0deg,${LOYALTY_CARD.qrInk} 0 1px,transparent 1px 2px),repeating-linear-gradient(90deg,${LOYALTY_CARD.qrInk} 0 1px,transparent 1px 2px)`,
            backgroundSize: "70% 70%",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
          aria-hidden
        />
      </div>
      <div className="relative z-10">
        <p
          className="text-[6px] tracking-widest uppercase"
          style={{ color: tpl.subtext }}
        >
          Carte fidélité
        </p>
        <p
          className="truncate text-[8px] leading-tight font-bold"
          style={{ color: tpl.text }}
        >
          Chez {merchantName || "…"}
        </p>
      </div>
    </div>
  );
}

/**
 * Console de génération des LOTS de cartes (SPEC-FIDELITE 4.0) : choix du
 * commerçant, du MODÈLE VISUEL (aperçus), de la quantité (plafond réglé dans
 * les bornes), puis PDF d'impression retéléchargeable À TOUT MOMENT depuis le
 * journal — le fichier est régénéré à la volée, jamais stocké.
 */
export function LoyaltyCardsConsole({
  batches,
  maxBatch,
}: {
  batches: LoyaltyBatchRow[];
  maxBatch: number;
}) {
  const router = useRouter();
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
  const merchantName = selected?.name ?? "";

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

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
            <Label>Commerçant</Label>
            <input
              type="hidden"
              name="merchant_id"
              value={selected?.id ?? ""}
            />
            <LoyaltyMerchantPicker selected={selected} onSelect={setSelected} />
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

        <div className="space-y-1.5">
          <Label>Modèle visuel</Label>
          <input type="hidden" name="template_key" value={template} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_TEMPLATES.map((tplDef) => (
              <button
                key={tplDef.key}
                type="button"
                onClick={() => setTemplate(tplDef.key)}
                aria-pressed={template === tplDef.key}
                className={cn(
                  "rounded-md p-1.5 text-start transition",
                  template === tplDef.key
                    ? "ring-primary-500 bg-primary-50 ring-2"
                    : "hover:bg-surface-2"
                )}
              >
                <TemplatePreview
                  templateKey={tplDef.key}
                  merchantName={merchantName}
                />
                <p className="mt-1.5 text-xs font-bold">{tplDef.label}</p>
                <p className="text-subtle text-caption leading-tight">
                  {tplDef.desc}
                </p>
              </button>
            ))}
          </div>
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
              Lot de {state.quantity} cartes créé — pré-enregistrées « imprimées
              », sans valeur avant activation en caisse.
            </p>
            <a
              href={pdfHref(state.batchId)}
              target="_blank"
              rel="noreferrer"
              className="bg-success-600 hover:bg-success-700 flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-bold text-white"
            >
              <Download className="size-4" />
              Télécharger le PDF
            </a>
          </div>
        )}

        <ActionButton
          type="submit"
          state={fb}
          disabled={!selected}
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

      {/* Journal des lots : qui, quand, combien, pour quel commerçant. */}
      <div className="border-border bg-surface rounded-lg border">
        <p className="border-border flex items-center gap-2 border-b px-4 py-3 text-sm font-bold">
          <Layers className="text-primary-600 size-4" />
          Journal des lots
        </p>
        {batches.length === 0 ? (
          <p className="text-muted px-4 py-6 text-center text-sm">
            Aucun lot généré pour l&apos;instant.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {batches.map((b) => {
              const tpl = getCardTemplate(b.template_key);
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {b.merchant_name}
                      <span className="text-muted font-medium">
                        {" "}
                        · {b.quantity} cartes
                      </span>
                    </p>
                    <p className="text-subtle text-xs">
                      {dayFr(b.created_at)}
                      {b.created_by_email ? ` · ${b.created_by_email}` : ""}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <span
                      className="size-3 rounded-full border"
                      style={{ background: tpl.bg, borderColor: tpl.accent }}
                      aria-hidden
                    />
                    {tpl.label}
                  </span>
                  <span className="text-muted text-xs tabular-nums">
                    {b.printed} à distribuer · {b.activated} activées ·{" "}
                    {b.linked} liées
                    {b.blocked > 0 ? ` · ${b.blocked} bloquées` : ""}
                  </span>
                  <a
                    href={pdfHref(b.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="border-border hover:bg-surface-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold"
                  >
                    <Download className="size-3.5" />
                    PDF
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
