"use client";

import { useEffect, useState } from "react";

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
      const res = await p.print({
        commands: [
          { type: "align", value: "center" },
          { type: "size", value: 32 },
          { type: "textBold", text: "TEST COLIGO" },
          { type: "size", value: 20 },
          { type: "text", text: "Si tu lis ceci, le bridge marche." },
          { type: "wrap", n: 2 },
          { type: "qr", data: "https://coligo.app", moduleSize: 6 },
        ],
        copies: 1,
      });
      log(`print → ${JSON.stringify(res)}`);
    } catch (e) {
      log(`print threw : ${(e as Error)?.message ?? e}`);
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
