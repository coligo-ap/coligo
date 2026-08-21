"use client";

import { useState } from "react";
import {
  Contact,
  Download,
  FileImage,
  Loader2,
  Palette,
  Printer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/native/download-file";
import { FLYER_THEMES, type FlyerThemeKey } from "@/lib/design/tokens";

// Console « Flyers » : flyer publicitaire Coligo recto/verso aux DIMENSIONS
// LIBRES (cm) avec MODÈLES de couleur, accroche darija, phrase script et
// phrases d'avantages au choix + la CARTE DE VISITE Coligo. PDF générés à la
// volée (/api/pdf/flyer, /api/pdf/carte-visite) — jamais stockés.

const PRESETS: { key: string; label: string; w: number; h: number }[] = [
  { key: "a6", label: "A6 · 10,5 × 14,8", w: 10.5, h: 14.8 },
  { key: "a5", label: "A5 · 14,8 × 21", w: 14.8, h: 21 },
  { key: "a4", label: "A4 · 21 × 29,7", w: 21, h: 29.7 },
  { key: "dl", label: "DL · 10 × 21", w: 10, h: 21 },
];

// Miroir de FLYER_HOOKS/FLYER_PERKS (lib/marketing/flyer-pdf est SERVEUR :
// il importe sharp — on ne l'importe jamais dans un composant client).
const HOOKS: { key: string; ar: string; fr: string }[] = [
  { key: "kolch", ar: "كلش يوصلك", fr: "Tout t'arrive" },
  { key: "chri", ar: "شري و تهنّى", fr: "Achète tranquille" },
  { key: "win", ar: "وين ما تكون", fr: "Où que tu sois" },
];
const PERKS = [
  "PROMOS & RÉDUCTIONS",
  "COMMANDE À L'AVANCE",
  "LIVRAISON À DOMICILE",
  "CARTE WELA CASH",
  "CARTE DE FIDÉLITÉ",
  "PROMOS EN DIRECT",
  "RÉCUPÈRE BLA MA DIR LACHAINE",
  "DAHABIA, CIB WELA CASH",
];
const SCRIPTS = ["Wech testenna ?", "Sahla mahla !", "Kolchi f'Coligo !"];

export function FlyersConsole() {
  const [w, setW] = useState("14.8");
  const [h, setH] = useState("21");
  const [theme, setTheme] = useState<FlyerThemeKey>("violet");
  const [hook, setHook] = useState("kolch");
  const [script, setScript] = useState(SCRIPTS[0]);
  const [perks, setPerks] = useState<number[]>([0, 1, 2, 3, 4]);
  const [busy, setBusy] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
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

  function togglePerk(i: number) {
    setPerks((prev) =>
      prev.includes(i)
        ? prev.filter((x) => x !== i)
        : prev.length >= 5
          ? prev
          : [...prev, i]
    );
  }

  async function download() {
    if (!valid || busy || perks.length === 0) return;
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({
      w: String(wNum),
      h: String(hNum),
      theme,
      hook,
      script,
      phrases: perks.join(","),
    });
    const r = await downloadFile(
      `/api/pdf/flyer?${params}`,
      `flyer-coligo-${wNum}x${hNum}cm-${theme}.pdf`
    );
    if (!r.ok) setError("Téléchargement impossible. Réessayez.");
    setBusy(false);
  }

  async function downloadCard() {
    if (cardBusy) return;
    setCardBusy(true);
    setError(null);
    const r = await downloadFile(
      "/api/pdf/carte-visite",
      "carte-visite-coligo.pdf"
    );
    if (!r.ok) setError("Téléchargement impossible. Réessayez.");
    setCardBusy(false);
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

        {/* Modèle couleur — aperçu = le vrai dégradé du fond. */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Palette className="size-3.5" />
            Modèle
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              Object.entries(FLYER_THEMES) as [
                FlyerThemeKey,
                (typeof FLYER_THEMES)[FlyerThemeKey],
              ][]
            ).map(([key, t]) => (
              <button
                key={key}
                type="button"
                aria-pressed={theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  "rounded-md p-1.5 text-start transition",
                  theme === key
                    ? "ring-primary-500 bg-primary-50 ring-2"
                    : "hover:bg-surface-2"
                )}
              >
                <span
                  className="block h-10 w-full rounded-md"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${t.g1}, ${t.g2} 50%, ${t.g3} 80%, ${t.g4})`,
                  }}
                  aria-hidden
                />
                <span className="mt-1 block text-xs font-bold">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Accroche darija (le gros titre arabe du recto). */}
        <div className="space-y-1.5">
          <Label>Accroche</Label>
          <div className="flex flex-wrap gap-1.5">
            {HOOKS.map((hk) => (
              <button
                key={hk.key}
                type="button"
                aria-pressed={hook === hk.key}
                onClick={() => setHook(hk.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-bold transition",
                  hook === hk.key
                    ? "bg-primary-600 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground"
                )}
              >
                <span dir="rtl">{hk.ar}</span>
                <span className="ms-1.5 text-xs font-medium opacity-75">
                  {hk.fr}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Phrase script (latin, style manuscrit du recto). */}
        <div className="space-y-1.5">
          <Label htmlFor="flyer-script">Phrase d&apos;ouverture</Label>
          <div className="flex flex-wrap gap-1.5">
            {SCRIPTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={script === s}
                onClick={() => setScript(s)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-bold transition",
                  script === s
                    ? "bg-primary-600 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Input
            id="flyer-script"
            value={script}
            maxLength={40}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Ou écris la tienne (40 caractères max)"
            disabled={busy}
          />
        </div>

        {/* Phrases d'avantages (pilules du recto) — 5 max. */}
        <div className="space-y-1.5">
          <Label>Phrases à mettre (max 5)</Label>
          <div className="flex flex-wrap gap-1.5">
            {PERKS.map((p, i) => {
              const active = perks.includes(i);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePerk(i)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold transition",
                    active
                      ? "bg-primary-600 text-white"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
          {perks.length === 0 && (
            <p className="text-danger-600 text-xs">
              Choisissez au moins une phrase.
            </p>
          )}
        </div>

        {error && <p className="text-danger-600 text-sm">{error}</p>}

        <button
          type="button"
          disabled={!valid || busy || perks.length === 0}
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

      {/* Carte de visite Coligo (contacts officiels). */}
      <div className="border-border bg-surface space-y-3 rounded-lg border p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold">
            <Contact className="text-primary-600 size-4" />
            Carte de visite Coligo
          </p>
          <p className="text-subtle mt-1 text-xs">
            Format carte bancaire, recto/verso : logo + contacts (0564 70 36 31,
            contact@coligo.app, www.coligo.app, Facebook et Instagram « Coligo
            App ») + QR du site.
          </p>
        </div>
        <button
          type="button"
          disabled={cardBusy}
          onClick={() => void downloadCard()}
          className="border-border hover:bg-surface-2 flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-bold transition disabled:opacity-60"
        >
          {cardBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Télécharger la carte de visite
        </button>
      </div>

      <div className="border-border bg-surface flex items-start gap-2.5 rounded-lg border p-3.5">
        <Printer className="text-primary-600 mt-0.5 size-4 shrink-0" />
        <p className="text-muted text-xs leading-relaxed">
          Pour l&apos;imprimeur : le flyer sort aux dimensions exactes demandées
          en pleine page ; la carte de visite sort au format CR80 avec fonds
          perdus 3 mm et traits de coupe.
        </p>
      </div>
    </section>
  );
}
