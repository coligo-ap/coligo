/**
 * Bridge JS pour le plugin natif Capacitor « SunmiPrinter »
 * (cf. `android/app/src/main/java/com/coligo/app/sunmi/SunmiPrinterPlugin.java`).
 *
 * Importable côté web sans planter : si Capacitor n'est pas chargé (PWA pure),
 * `getPlugin()` renvoie `null` et `isSunmiPrinterAvailable()` est `false`.
 */

export type SunmiAlign = "left" | "center" | "right";

export type SunmiCommand =
  | { type: "init" }
  | { type: "align"; value: SunmiAlign }
  | { type: "size"; value: number }
  | { type: "bold"; value: boolean }
  | { type: "invert"; value: boolean }
  | { type: "text"; text: string; newline?: boolean }
  | { type: "textBold"; text: string; newline?: boolean }
  | { type: "textBoldStrong"; text: string; newline?: boolean }
  | { type: "textInverse"; text: string; newline?: boolean }
  | {
      type: "columns";
      cols: string[];
      widths: number[];
      aligns?: SunmiAlign[];
    }
  | {
      type: "qr";
      data: string;
      moduleSize?: number;
      errorLevel?: 0 | 1 | 2 | 3;
    }
  | { type: "wrap"; n: number }
  | { type: "cut" }
  | { type: "paper"; columns: number }
  | { type: "lineSpacing"; dots: number };

export type PrintOptions = {
  commands: SunmiCommand[];
  copies?: number;
  /** Réinitialise l'imprimante avant chaque copie. Défaut : `true`. */
  init?: boolean;
  /** Coupe le papier après chaque copie. Défaut : `true`. */
  cut?: boolean;
};

export type PrintBitmapOptions = {
  /**
   * PNG encodé en base64, SANS le préfixe `data:image/png;base64,`.
   * Largeur cible : 576px max (zone imprimable 80mm V3 = 8 dots/mm × 72mm).
   * Au-delà, le firmware découpe à droite.
   */
  bitmap: string;
  copies?: number;
  /**
   * Encadre l'impression par `enterPrinterBuffer(true)` / `exitPrinterBuffer(true)` :
   * tout sort en bloc atomique. Défaut : `true`.
   */
  buffer?: boolean;
  /** Coupe le papier après chaque copie. Défaut : `true`. */
  cut?: boolean;
  /** Nombre de line wraps avant la coupe (marge basse). Défaut : 3. */
  feedLines?: number;
};

type SunmiPlugin = {
  isAvailable: () => Promise<{
    available: boolean;
    error?: string;
    model?: string;
  }>;
  print: (opts: PrintOptions) => Promise<{ printed: number }>;
  printBitmap: (opts: PrintBitmapOptions) => Promise<{ printed: number }>;
};

type CapacitorGlobal = {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  Plugins: Record<string, unknown>;
};

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Capacitor?: CapacitorGlobal };
  return w.Capacitor ?? null;
}

function getPlugin(): SunmiPlugin | null {
  const cap = getCapacitor();
  if (!cap) return null;
  // Capacitor injecte le plugin Java sous le même nom que la valeur de
  // `@CapacitorPlugin(name = "SunmiPrinter")`.
  const plugin = cap.Plugins?.SunmiPrinter as SunmiPlugin | undefined;
  return plugin ?? null;
}

/** Synchrone : `true` si on est dans un APK Capacitor avec le plugin chargé. */
export function isSunmiPluginLoaded(): boolean {
  return getPlugin() !== null;
}

/**
 * Asynchrone : `true` si le plugin est chargé ET le service Sunmi est bindé.
 * À utiliser avant d'envoyer un ticket — un APK Capacitor sur tablette
 * non-Sunmi répondra `available: false`.
 */
export async function isSunmiPrinterAvailable(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.isAvailable();
    return res.available === true;
  } catch {
    return false;
  }
}

/** Envoie une liste de commandes Sunmi à l'imprimante intégrée. */
export async function printSunmi(opts: PrintOptions): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    await plugin.print(opts);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[sunmi-printer] print failed", err);
    }
    return false;
  }
}

/**
 * Envoie un PNG base64 à l'imprimante Sunmi (chemin « capture HTML → image »).
 * Le caller fournit un base64 SANS le préfixe data:image/png;base64,.
 * Retourne `true` si l'impression a démarré, `false` si le plugin n'est pas
 * dispo (PWA) ou si le service AIDL n'est pas bindé.
 */
export async function printSunmiBitmap(
  opts: PrintBitmapOptions
): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    await plugin.printBitmap(opts);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[sunmi-printer] printBitmap failed", err);
    }
    return false;
  }
}
