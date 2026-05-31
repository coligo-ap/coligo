"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  Layers,
  Loader2,
  Printer,
  Ruler,
  Save,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  AUTO_PRINT_LABEL,
  type AutoPrintMode,
  type PrintSettings,
  type PrintWidth,
} from "@/lib/types";
import { setPrintSettings } from "@/app/(merchant)/settings/actions";
import { printOrderTicket } from "@/lib/ticket/print-order";
import { OrderTicket } from "@/components/ticket/order-ticket";
import { buildFakeTicketOrder } from "@/lib/ticket/fake-ticket-order";
import { cn } from "@/lib/utils";

type Props = {
  initial: PrintSettings;
  merchantName: string;
};

type Row = "auto_accept_orders" | "auto_print" | "print_copies" | "print_width";

export function PrintSettingsForm({ initial, merchantName }: Props) {
  const [state, setState] = useState<PrintSettings>(initial);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Row | null>(null);
  const [previewCash, setPreviewCash] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [printing, setPrinting] = useState(false);

  const dirty =
    state.auto_accept_orders !== initial.auto_accept_orders ||
    state.auto_print !== initial.auto_print ||
    state.print_copies !== initial.print_copies ||
    state.print_width !== initial.print_width;

  function toggleOpen(row: Row) {
    setOpen((cur) => (cur === row ? null : row));
  }

  function save() {
    startTransition(async () => {
      const res = await setPrintSettings(state);
      if (res.error) toast.error(res.error);
      else toast.success(res.success ?? "Réglages enregistrés.");
    });
  }

  async function printTest() {
    setPrinting(true);
    try {
      const fake = buildFakeTicketOrder({ merchantName, paid: !previewCash });
      await printOrderTicket(fake, {
        width: state.print_width,
        copies: state.print_copies,
      });
    } catch {
      toast.error("Impression impossible.");
    } finally {
      setPrinting(false);
    }
  }

  const previewOrder = buildFakeTicketOrder({
    merchantName,
    paid: !previewCash,
  });

  return (
    <div className="space-y-4">
      {/* Résumé compact : tout l'état sur 4 chips lisibles d'un coup d'œil */}
      <SummaryStrip state={state} />

      {/* Accordéon : un réglage par ligne, déplié au clic */}
      <div className="border-border bg-surface divide-border divide-y rounded-[14px] border">
        <AccordionRow
          icon={Zap}
          label="Acceptation auto"
          value={state.auto_accept_orders ? "Activée" : "Désactivée"}
          open={open === "auto_accept_orders"}
          onToggle={() => toggleOpen("auto_accept_orders")}
        >
          <p className="text-muted mb-3 text-xs">
            Les nouvelles commandes sont acceptées automatiquement après un
            compte-à-rebours de 10 s (vous pouvez refuser avant). Sinon, la
            commande s&apos;affiche en plein écran et doit être acceptée sous 15
            min, sans quoi elle est refusée.
          </p>
          <Toggle
            on={state.auto_accept_orders}
            onChange={(on) =>
              setState((s) => ({ ...s, auto_accept_orders: on }))
            }
          />
        </AccordionRow>

        <AccordionRow
          icon={Bot}
          label="Impression auto"
          value={AUTO_PRINT_LABEL[state.auto_print]}
          open={open === "auto_print"}
          onToggle={() => toggleOpen("auto_print")}
        >
          <p className="text-muted mb-3 text-xs">
            Quand imprimer le ticket sans intervention.
          </p>
          <SegmentedSelect<AutoPrintMode>
            value={state.auto_print}
            options={[
              { value: "off", label: "Désactivée" },
              { value: "on_receive", label: "À la réception" },
              { value: "on_accept", label: "À l'acceptation" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, auto_print: v }))}
            block
          />
        </AccordionRow>

        <AccordionRow
          icon={Layers}
          label="Copies"
          value={`${state.print_copies}×`}
          open={open === "print_copies"}
          onToggle={() => toggleOpen("print_copies")}
        >
          <p className="text-muted mb-3 text-xs">
            Combien d&apos;exemplaires imprimer à chaque commande.
          </p>
          <SegmentedSelect<number>
            value={state.print_copies}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 3, label: "3" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_copies: v }))}
          />
        </AccordionRow>

        <AccordionRow
          icon={Ruler}
          label="Largeur"
          value={`${state.print_width} mm`}
          open={open === "print_width"}
          onToggle={() => toggleOpen("print_width")}
        >
          <p className="text-muted mb-3 text-xs">
            58 mm pour les Sunmi V2/V3, 80 mm pour les imprimantes comptoir.
          </p>
          <SegmentedSelect<PrintWidth>
            value={state.print_width}
            options={[
              { value: 58, label: "58 mm" },
              { value: 80, label: "80 mm" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_width: v }))}
          />
        </AccordionRow>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty || pending} size="sm">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Enregistrer
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowPreview((v) => !v)}
          type="button"
          size="sm"
        >
          <Eye className="size-4" />
          {showPreview ? "Masquer l'aperçu" : "Aperçu"}
        </Button>
        <Button
          variant="outline"
          onClick={printTest}
          disabled={printing}
          size="sm"
        >
          {printing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          Test impression
        </Button>
        <button
          type="button"
          onClick={() => setPreviewCash((v) => !v)}
          className="text-muted hover:bg-surface-2 ml-auto inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs"
          title="Bascule le mode paiement du ticket de test"
        >
          <Wand2 className="size-3.5" />
          {previewCash ? "Test : cash" : "Test : payé en ligne"}
        </button>
      </div>

      {showPreview && (
        <div className="space-y-2">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">
            Aperçu ({state.print_width} mm) —{" "}
            {previewCash ? "Cash" : "Payé en ligne"}
          </p>
          <OrderTicket order={previewOrder} width={state.print_width} />
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

function SummaryStrip({ state }: { state: PrintSettings }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <SummaryChip
        active={state.auto_accept_orders}
        label={state.auto_accept_orders ? "Auto-accept ON" : "Auto-accept OFF"}
      />
      <SummaryChip
        active={state.auto_print !== "off"}
        label={`Print : ${AUTO_PRINT_LABEL[state.auto_print]}`}
      />
      <SummaryChip
        neutral
        label={`${state.print_copies} copie${state.print_copies > 1 ? "s" : ""}`}
      />
      <SummaryChip neutral label={`${state.print_width} mm`} />
    </div>
  );
}

function SummaryChip({
  active,
  neutral,
  label,
}: {
  active?: boolean;
  neutral?: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        neutral
          ? "border-border bg-surface-3 text-muted"
          : active
            ? "border-primary-200 bg-primary-50 text-primary-700"
            : "border-border text-subtle bg-white"
      )}
    >
      {label}
    </span>
  );
}

function AccordionRow({
  icon: Icon,
  label,
  value,
  open,
  onToggle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <Icon className="text-muted size-4 shrink-0" />
        <span className="text-foreground flex-1 text-sm font-medium">
          {label}
        </span>
        <span className="text-muted shrink-0 text-xs tabular-nums">
          {value}
        </span>
        <ChevronDown
          className={cn(
            "text-subtle size-4 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="bg-surface-2 px-4 pt-2 pb-4">{children}</div>}
    </div>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        on ? "bg-primary-600" : "bg-surface-3"
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function SegmentedSelect<T extends string | number>({
  value,
  options,
  onChange,
  block = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-surface border-border-strong inline-flex gap-1 rounded-[10px] border p-1",
        block && "w-full"
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors",
              block && "flex-1",
              active
                ? "bg-primary-600 text-white"
                : "text-muted hover:bg-surface-2"
            )}
          >
            {active && <Check className="size-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
