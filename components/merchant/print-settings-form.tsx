"use client";

import { useState, useTransition } from "react";
import { Eye, Printer, Loader2, Save, Wand2 } from "lucide-react";
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

export function PrintSettingsForm({ initial, merchantName }: Props) {
  const [state, setState] = useState<PrintSettings>(initial);
  const [pending, startTransition] = useTransition();
  const [previewCash, setPreviewCash] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [printing, setPrinting] = useState(false);

  const dirty =
    state.auto_accept_orders !== initial.auto_accept_orders ||
    state.auto_print !== initial.auto_print ||
    state.print_copies !== initial.print_copies ||
    state.print_width !== initial.print_width;

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
    <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
      <div className="space-y-5">
        {/* Auto-accept */}
        <SettingRow
          title="Accepter automatiquement les commandes"
          description="Les nouvelles commandes passent directement en préparation, sans clic."
        >
          <Toggle
            on={state.auto_accept_orders}
            onChange={(on) =>
              setState((s) => ({ ...s, auto_accept_orders: on }))
            }
          />
        </SettingRow>

        {/* Auto-print */}
        <SettingRow
          title="Impression automatique"
          description="Quand imprimer le ticket sans intervention."
        >
          <SegmentedSelect<AutoPrintMode>
            value={state.auto_print}
            options={[
              { value: "off", label: AUTO_PRINT_LABEL.off },
              { value: "on_receive", label: AUTO_PRINT_LABEL.on_receive },
              { value: "on_accept", label: AUTO_PRINT_LABEL.on_accept },
            ]}
            onChange={(v) => setState((s) => ({ ...s, auto_print: v }))}
          />
        </SettingRow>

        {/* Copies */}
        <SettingRow
          title="Nombre de copies"
          description="Combien d'exemplaires imprimer à chaque commande (1 à 3)."
        >
          <SegmentedSelect<number>
            value={state.print_copies}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 3, label: "3" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_copies: v }))}
          />
        </SettingRow>

        {/* Largeur */}
        <SettingRow
          title="Largeur du ticket"
          description="58 mm pour les imprimantes Sunmi, 80 mm pour les imprimantes comptoir."
        >
          <SegmentedSelect<PrintWidth>
            value={state.print_width}
            options={[
              { value: 58, label: "58 mm" },
              { value: 80, label: "80 mm" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_width: v }))}
          />
        </SettingRow>

        <div className="border-border flex flex-wrap items-center gap-2 border-t pt-5">
          <Button onClick={save} disabled={!dirty || pending}>
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
          >
            <Eye className="size-4" />
            {showPreview ? "Masquer l'aperçu" : "Aperçu"}
          </Button>
          <Button variant="outline" onClick={printTest} disabled={printing}>
            {printing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Printer className="size-4" />
            )}
            Imprimer un ticket de test
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreviewCash((v) => !v)}
            type="button"
            title="Bascule le mode paiement du ticket de test"
          >
            <Wand2 className="size-4" />
            {previewCash ? "Tester : cash" : "Tester : payé en ligne"}
          </Button>
        </div>
      </div>

      {showPreview && (
        <div className="space-y-2">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">
            Aperçu ({state.print_width} mm)
          </p>
          <OrderTicket order={previewOrder} width={state.print_width} />
        </div>
      )}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-5 last:border-b-0 last:pb-0">
      <div className="max-w-md flex-1">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted mt-0.5 text-xs">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
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
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-surface-3 inline-flex gap-1 rounded-[10px] p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "text-primary-700 bg-white shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
