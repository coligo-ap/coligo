"use client";

import { useState } from "react";
import { Download, FileImage, Loader2, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/native/download-file";

// Console « Flyers » : le flyer publicitaire Coligo recto/verso (design
// darija + français, captures réelles de l'app, QR de téléchargement,
// badges stores) aux DIMENSIONS LIBRES en centimètres. Le PDF est généré à
// la volée par /api/pdf/flyer — jamais stocké.

const PRESETS: { key: string; label: string; w: number; h: number }[] = [
  { key: "a6", label: "A6 · 10,5 × 14,8", w: 10.5, h: 14.8 },
  { key: "a5", label: "A5 · 14,8 × 21", w: 14.8, h: 21 },
  { key: "a4", label: "A4 · 21 × 29,7", w: 21, h: 29.7 },
  { key: "dl", label: "DL · 10 × 21", w: 10, h: 21 },
];

export function FlyersConsole() {
  const [w, setW] = useState("14.8");
  const [h, setH] = useState("21");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wNum = Number(w.replace(",", "."));
  const hNum = Number(h.replace(",", "."));
  const valid =
    Number.isFinite(wNum) &&
    Number.isFinite(hNum) &&
    wNum >= 5 &&
    wNum <= 100 &&
    hNum >= 5 &&
    hNum <= 100;

  async function download() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const r = await downloadFile(
      `/api/pdf/flyer?w=${wNum}&h=${hNum}`,
      `flyer-coligo-${wNum}x${hNum}cm.pdf`
    );
    if (!r.ok) setError("Téléchargement impossible. Réessayez.");
    setBusy(false);
  }

  return (
    <section className="space-y-4">
      <div className="border-border bg-surface space-y-4 rounded-lg border p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold">
            <FileImage className="text-primary-600 size-4" />
            Flyer publicitaire Coligo
          </p>
          <p className="text-subtle mt-1 text-xs">
            Recto/verso prêt à imprimer : accroches darija + français, captures
            réelles de l&apos;appli, QR de téléchargement, badges App Store et
            Google Play. À distribuer par les commerçants.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Format</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = wNum === p.w && hNum === p.h;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setW(String(p.w));
                    setH(String(p.h));
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold transition",
                    active
                      ? "bg-primary-600 text-white"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="flyer-w">Largeur (cm)</Label>
            <Input
              id="flyer-w"
              inputMode="decimal"
              value={w}
              onChange={(e) => setW(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="flyer-h">Hauteur (cm)</Label>
            <Input
              id="flyer-h"
              inputMode="decimal"
              value={h}
              onChange={(e) => setH(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <p className="text-subtle text-xs">
          De 5 à 100 cm par côté. Le design s&apos;adapte automatiquement au
          format (pensé pour le portrait).
        </p>

        {error && <p className="text-danger-600 text-sm">{error}</p>}

        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void download()}
          className="bg-primary-600 hover:bg-primary-700 flex h-11 w-full items-center justify-center gap-2 rounded-md text-sm font-extrabold text-white transition disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {busy
            ? "Génération…"
            : `Télécharger le flyer ${valid ? `${wNum} × ${hNum} cm` : ""}`}
        </button>
      </div>

      <div className="border-border bg-surface flex items-start gap-2.5 rounded-lg border p-3.5">
        <Printer className="text-primary-600 mt-0.5 size-4 shrink-0" />
        <p className="text-muted text-xs leading-relaxed">
          Pour l&apos;imprimeur : le PDF sort aux dimensions exactes demandées,
          en pleine page (fond perdu intégré au design). Recto = accroche +
          marketplace ; verso = avantages + fiche commerçant.
        </p>
      </div>
    </section>
  );
}
