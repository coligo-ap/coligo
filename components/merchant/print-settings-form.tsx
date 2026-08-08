"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  Check,
  Eye,
  Languages,
  Layers,
  Loader2,
  Printer,
  Ruler,
  Save,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  type AutoPrintMode,
  type PrintLang,
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
  const [note, setNote] = useActionNote();
  const [previewCash, setPreviewCash] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [printing, setPrinting] = useState(false);

  const dirty =
    state.auto_accept_orders !== initial.auto_accept_orders ||
    state.auto_print !== initial.auto_print ||
    state.print_copies !== initial.print_copies ||
    state.print_width !== initial.print_width ||
    state.print_lang !== initial.print_lang;

  function save() {
    startTransition(async () => {
      const res = await setPrintSettings(state);
      if (res.error) setNote({ ok: false, text: res.error });
      else setNote({ ok: true, text: res.success ?? "Réglages enregistrés." });
    });
  }

  async function printTest() {
    setPrinting(true);
    try {
      const fake = buildFakeTicketOrder({ merchantName, paid: !previewCash });
      await printOrderTicket(fake, {
        width: state.print_width,
        copies: state.print_copies,
        lang: state.print_lang,
      });
    } catch {
      setNote({ ok: false, text: "Impression impossible." });
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
      {/* Réglages à plat — tout visible d'un coup, sans clic pour déplier. */}
      <div className="space-y-3">
        <SettingRow
          icon={Zap}
          label="Acceptation automatique"
          help="Accepte les commandes après 10 s (vous pouvez refuser avant). Sinon, à valider sous 15 min."
        >
          <Toggle
            on={state.auto_accept_orders}
            onChange={(on) =>
              setState((s) => ({ ...s, auto_accept_orders: on }))
            }
          />
        </SettingRow>

        <SettingRow
          icon={Bot}
          label="Impression automatique"
          help="Quand imprimer le ticket sans intervention."
        >
          <SegmentedSelect<AutoPrintMode>
            value={state.auto_print}
            options={[
              { value: "off", label: "Non" },
              { value: "on_receive", label: "À la réception" },
              { value: "on_accept", label: "À l'acceptation" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, auto_print: v }))}
            block
          />
        </SettingRow>

        <SettingRow
          icon={Layers}
          label="Nombre de copies"
          help="Exemplaires imprimés à chaque commande."
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

        <SettingRow
          icon={Ruler}
          label="Largeur du papier"
          help="50 mm : Sunmi V3 · 58 mm : Sunmi V2 · 80 mm : imprimante comptoir."
        >
          <SegmentedSelect<PrintWidth>
            value={state.print_width}
            options={[
              { value: 50, label: "50 mm" },
              { value: 58, label: "58 mm" },
              { value: 80, label: "80 mm" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_width: v }))}
          />
        </SettingRow>

        <SettingRow
          icon={Languages}
          label="Langue du ticket"
          help="Le ticket s'imprime dans UNE seule langue — jamais français et arabe mélangés."
        >
          <SegmentedSelect<PrintLang>
            value={state.print_lang}
            options={[
              { value: "fr", label: "Français" },
              { value: "ar", label: "العربية" },
            ]}
            onChange={(v) => setState((s) => ({ ...s, print_lang: v }))}
          />
        </SettingRow>
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
          className="text-muted hover:bg-surface-2 rounded-control ml-auto inline-flex h-9 items-center gap-1.5 px-3 text-xs"
          title="Bascule le mode paiement du ticket de test"
        >
          <Wand2 className="size-3.5" />
          {previewCash ? "Test : cash" : "Test : payé en ligne"}
        </button>
      </div>

      <ActionNote note={note} />

      {showPreview && (
        <div className="space-y-2">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">
            Aperçu ({state.print_width} mm) —{" "}
            {previewCash ? "Cash" : "Payé en ligne"}
          </p>
          <OrderTicket
            order={previewOrder}
            width={state.print_width}
            lang={state.print_lang}
          />
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

function SettingRow({
  icon: Icon,
  label,
  help,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-md border p-3.5">
      <div className="flex items-center gap-2.5">
        <Icon className="text-primary-500 size-4 shrink-0" />
        <span className="text-foreground text-sm font-semibold">{label}</span>
      </div>
      <p className="text-muted mt-1 mb-2.5 text-xs">{help}</p>
      {children}
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
          // `left` plutôt que `translate-x` : compatible avec le vieux WebView
          // Sunmi (qui ignore la propriété `translate:` de Tailwind v4).
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
          on ? "left-5.5" : "left-0.5"
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
        "bg-surface border-border-strong rounded-control inline-flex gap-1 border p-1",
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
              "inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
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
