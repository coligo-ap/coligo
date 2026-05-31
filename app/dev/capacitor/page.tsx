"use client";

import { useEffect, useState } from "react";
import { buildTicketSunmiCommands } from "@/lib/ticket/build-ticket-sunmi";
import { buildFakeTicketOrder } from "@/lib/ticket/fake-ticket-order";

/**
 * Page diagnostic pour vérifier l'intégration Capacitor + plugin Sunmi
 * depuis le WebView de l'APK. Accessible à `/dev/capacitor`.
 *
 * Affiche :
 *  - si `window.Capacitor` est injecté
 *  - le platform (`android` / `ios` / `web`)
 *  - la liste des plugins exposés (devrait contenir `SunmiPrinter`)
 *  - un bouton qui appelle `SunmiPrinter.isAvailable()` et affiche le résultat
 *  - un bouton qui imprime un ticket de test minimal
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

type SunmiPlugin = {
  isAvailable: () => Promise<{ available: boolean; error?: string }>;
  print: (opts: {
    commands: Array<Record<string, unknown>>;
    copies?: number;
  }) => Promise<{ printed: number }>;
};

function cap(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null
  );
}

function sunmi(): SunmiPlugin | null {
  const c = cap();
  return (c?.Plugins?.SunmiPrinter as SunmiPlugin | undefined) ?? null;
}

export default function CapacitorDiagPage() {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  useEffect(() => {
    const c = cap();
    const data = {
      hasCapacitor: !!c,
      isNative: c?.isNativePlatform?.() ?? null,
      platform: c?.getPlatform?.() ?? null,
      plugins: c?.Plugins ? Object.keys(c.Plugins) : [],
      hasSunmiPlugin: !!sunmi(),
      userAgent: navigator.userAgent,
    };
    setInfo(data);
    // Aussi en console → récupérable via `adb logcat -s chromium:I` sans
    // avoir à lire l'écran de l'appareil.
    try {
      console.info("[diag] runtime " + JSON.stringify(data));
    } catch {
      /* ignored */
    }
  }, []);

  function log(msg: string) {
    setActionLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} — ${msg}`,
    ]);
  }

  async function checkSunmi() {
    const p = sunmi();
    if (!p) {
      log("ERROR : Capacitor.Plugins.SunmiPrinter introuvable");
      return;
    }
    try {
      const res = await p.isAvailable();
      log(`isAvailable → ${JSON.stringify(res)}`);
    } catch (e) {
      log(`isAvailable threw : ${(e as Error)?.message ?? e}`);
    }
  }

  async function testPrint() {
    const p = sunmi();
    if (!p) {
      log("ERROR : Plugin Sunmi absent — impossible de tester l'impression");
      return;
    }
    try {
      // On utilise le VRAI builder de ticket avec une commande factice — ça
      // teste exactement le même chemin que l'auto-print sur une commande
      // réelle. Le builder logge un preview ASCII dans la console au
      // passage : tu peux vérifier dans le journal ci-dessous que le
      // layout est ce qu'on attend AVANT d'imprimer.
      const fake = buildFakeTicketOrder({
        merchantName: "Boulangerie Demo",
        paid: false,
      });
      // Rouleau intégré Sunmi V3 = 50 mm → 32 colonnes. (AVANT : 80 = 48 cols,
      // ce qui faisait WRAPPER chaque ligne sur 2 lignes physiques sur le
      // rouleau 50 mm → ticket 2× trop long et plein de « lignes vides ».)
      const commands = buildTicketSunmiCommands(fake, {
        width: 50,
        appName: "Coligo",
      }) as Array<Record<string, unknown>>;
      log(`commandes générées : ${commands.length}`);
      const res = await p.print({ commands, copies: 1 });
      log(`print → ${JSON.stringify(res)}`);
    } catch (e) {
      log(`print threw : ${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * Impression de TEST minimale : 5 lignes, AUCUN builder, AUCUN espace
   * superflu. Sert à mesurer sur le papier réel :
   *   - la hauteur exacte d'une ligne (donc la longueur d'un ticket),
   *   - que le firmware respecte bien gauche / centre / droite,
   *   - que le « gros » (double largeur/hauteur) sort net.
   *
   * Si ces 5 lignes tiennent sur ~2-3 cm → l'imprimante va bien et un ticket
   * trop long vient juste d'un excès de lignes (ou d'un wrap 48→32 cols).
   * Si ces 5 lignes sortent sur 20 cm → c'est l'interligne firmware le coupable.
   */
  async function testSimplePrint() {
    const p = sunmi();
    if (!p) {
      log("ERROR : Plugin Sunmi absent — impossible de tester l'impression");
      return;
    }
    try {
      // 32 colonnes = laize réelle du rouleau intégré 50 mm. On NE met PAS de
      // wrap/feed entre les lignes : le plugin Java ajoute déjà sa marge basse
      // (3 lignes) + la coupe. Donc 5 lignes = 5 lignes, rien de plus.
      const commands: Array<Record<string, unknown>> = [
        { type: "paper", columns: 32 },
        // Interligne minimal (≈0.5 mm) — lignes serrées, pas de blanc inutile.
        { type: "lineSpacing", dots: 4 },

        // Ligne 1 — GRANDE police (double largeur + double hauteur).
        { type: "align", value: "left" },
        { type: "textBoldStrong", text: "LIGNE 1 GRANDE" },

        // Ligne 2 — taille réduite (police par défaut), à gauche.
        { type: "size", value: 24 },
        { type: "text", text: "Ligne 2 - taille normale" },

        // Ligne 3 — centrée.
        { type: "align", value: "center" },
        { type: "text", text: "Ligne 3 - centree" },

        // Ligne 4 — alignée à droite.
        { type: "align", value: "right" },
        { type: "text", text: "Ligne 4 - a droite" },

        // Ligne 5 — alignée à gauche.
        { type: "align", value: "left" },
        { type: "text", text: "Ligne 5 - a gauche" },
      ];
      log(`test simple : ${commands.length} commandes (5 lignes)`);
      const res = await p.print({ commands, copies: 1 });
      log(`print simple → ${JSON.stringify(res)}`);
    } catch (e) {
      log(`print simple threw : ${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * Test TAILLES + POSITIONS : 6 lignes, CHACUNE une taille de police
   * différente ET un emplacement différent. Utilise la commande `line`
   * (API haut-niveau PURE Sunmi : setAlignment + setFontSize + printText,
   * AUCUN octet ESC/POS brut). Double objectif :
   *   1. voir quelles tailles sortent réellement et comment l'alignement se
   *      comporte (gauche / centre / droite) pour chaque taille ;
   *   2. vérifier si ce chemin « propre » supprime le sur-interligne (4 cm/
   *      ligne) observé avec printColumnsText + emphase brute.
   *
   * ⚠️ Nécessite l'APK reconstruit (commande native `line` ajoutée côté Java).
   */
  async function testSizesPrint() {
    const p = sunmi();
    if (!p) {
      log("ERROR : Plugin Sunmi absent — impossible de tester l'impression");
      return;
    }
    try {
      const commands: Array<Record<string, unknown>> = [
        { type: "paper", columns: 32 },
        { type: "lineSpacing", dots: 0 },
        // size = taille firmware ; align = position. 6 combinaisons distinctes.
        {
          type: "line",
          text: "L1 taille 16 - gauche",
          size: 16,
          align: "left",
        },
        {
          type: "line",
          text: "L2 taille 24 - centre",
          size: 24,
          align: "center",
        },
        {
          type: "line",
          text: "L3 taille 28 - droite",
          size: 28,
          align: "right",
        },
        {
          type: "line",
          text: "L4 taille 32 - gauche",
          size: 32,
          align: "left",
        },
        {
          type: "line",
          text: "L5 taille 48 - centre",
          size: 48,
          align: "center",
        },
        // Ligne 6 : tente une taille HORS set connu (56) sans snap → sonde si
        // le firmware accepte plus gros. Si rejetée, la ligne sortira vide.
        {
          type: "line",
          text: "L6 taille 56 - droite",
          size: 56,
          align: "right",
          snap: false,
        },
      ];
      log(`test tailles : ${commands.length} commandes (6 lignes)`);
      const res = await p.print({ commands, copies: 1 });
      log(`print tailles → ${JSON.stringify(res)}`);
    } catch (e) {
      log(`print tailles threw : ${(e as Error)?.message ?? e}`);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-bold">Diagnostic Capacitor / Sunmi</h1>

      <section className="mb-6 rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Runtime</h2>
        <pre className="overflow-auto rounded bg-stone-50 p-3 text-xs">
          {info ? JSON.stringify(info, null, 2) : "Chargement…"}
        </pre>
      </section>

      <section className="mb-6 rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={checkSunmi}
            className="inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            SunmiPrinter.isAvailable()
          </button>
          <button
            type="button"
            onClick={testSimplePrint}
            className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Test simple (5 lignes)
          </button>
          <button
            type="button"
            onClick={testSizesPrint}
            className="inline-flex h-10 items-center rounded-lg bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
          >
            Test tailles + positions (6 lignes)
          </button>
          <button
            type="button"
            onClick={testPrint}
            className="inline-flex h-10 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50"
          >
            Imprimer un ticket de test
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Journal</h2>
        {actionLog.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune action exécutée.</p>
        ) : (
          <ol className="space-y-1 font-mono text-xs">
            {actionLog.map((entry, i) => (
              <li key={i} className="border-b border-stone-100 py-1">
                {entry}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
