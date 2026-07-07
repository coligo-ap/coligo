/**
 * Google Play In-App Updates — app CLIENT (app.coligo.client).
 *
 * Politique (recommandations Play) :
 *  - une mise à jour est disponible → update FLEXIBLE (téléchargement en
 *    arrière-plan via la feuille Play, l'utilisateur continue à naviguer,
 *    bannière « Redémarrer » quand c'est prêt). Proposée au plus 1×/24 h
 *    pour ne pas harceler.
 *  - versionCode installé < minimum imposé côté serveur (platform_settings.
 *    client_app_min_version_code, servie par /api/app/min-version) → update
 *    IMMEDIATE (plein écran Play, bloquante). Pour versions cassées.
 *
 * Le contenu (Next.js) vit sur le serveur : la plupart des évolutions ne
 * passent PAS par une release Play — ce flux ne sert que quand le socle natif
 * change (plugins, permissions, WebView).
 *
 * Tout est no-op hors WebView Capacitor Android, et silencieux si l'app n'est
 * pas installée depuis Play (sideload/debug : getAppUpdateInfo() rejette).
 */

import { getNativePlatform, isNative } from "./context";

export type AppUpdatePhase = "downloading" | "ready";

/** Throttle de la proposition FLEXIBLE (l'IMMEDIATE forcée ignore ce délai). */
const PROMPT_KEY = "coligo_flex_update_prompted_at";
const PROMPT_TTL_MS = 24 * 3600 * 1000;

// Valeurs des enums du plugin — recopiées en dur pour ne pas importer le
// module (et son code natif) dans le bundle web.
const UPDATE_AVAILABLE = 2;
const UPDATE_IN_PROGRESS = 3;
const STATUS_DOWNLOADING = 2;
const STATUS_FAILED = 5;
const STATUS_CANCELED = 6;
const STATUS_DOWNLOADED = 11;

function isAndroidNative(): boolean {
  return isNative() && getNativePlatform() === "android";
}

type AppUpdateModule = typeof import("@capawesome/capacitor-app-update");

let cachedModule: AppUpdateModule | null = null;
async function loadPlugin(): Promise<AppUpdateModule | null> {
  if (cachedModule) return cachedModule;
  if (!isAndroidNative()) return null;
  try {
    cachedModule = await import("@capawesome/capacitor-app-update");
    return cachedModule;
  } catch (err) {
    console.warn("[app-update] plugin import failed:", err);
    return null;
  }
}

async function fetchMinVersionCode(): Promise<number> {
  try {
    const res = await fetch("/api/app/min-version");
    if (!res.ok) return 0;
    const json = (await res.json()) as { minVersionCode?: number };
    return Number(json.minVersionCode ?? 0);
  } catch {
    return 0; // réseau KO → on ne force jamais (fail-open)
  }
}

function recentlyPrompted(): boolean {
  try {
    const at = Number(localStorage.getItem(PROMPT_KEY) ?? 0);
    return !!at && at > Date.now() - PROMPT_TTL_MS;
  } catch {
    return false;
  }
}

function markPrompted(): void {
  try {
    localStorage.setItem(PROMPT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Vérifie et lance le flux de mise à jour. `onPhase` remonte l'état utile à
 * l'UI (bannière « Redémarrer » quand `ready`). Retourne une fonction de
 * nettoyage (listener Play) à appeler au démontage.
 */
export async function runAppUpdateFlow(
  onPhase: (phase: AppUpdatePhase) => void
): Promise<() => void> {
  const mod = await loadPlugin();
  if (!mod) return () => {};
  const { AppUpdate } = mod;

  let info: Awaited<ReturnType<typeof AppUpdate.getAppUpdateInfo>>;
  try {
    info = await AppUpdate.getAppUpdateInfo();
  } catch {
    // App pas installée depuis Play (sideload / debug) : rien à faire.
    return () => {};
  }

  // Update IMMEDIATE interrompue (l'utilisateur a quitté en plein écran
  // Play) : Google recommande de la reprendre immédiatement.
  if (info.updateAvailability === UPDATE_IN_PROGRESS) {
    try {
      await AppUpdate.performImmediateUpdate();
    } catch {
      /* l'utilisateur pourra reprendre au prochain démarrage */
    }
    return () => {};
  }

  // Un téléchargement FLEXIBLE d'une session précédente attend l'installation.
  if (info.installStatus === STATUS_DOWNLOADED) {
    onPhase("ready");
    return () => {};
  }

  if (info.updateAvailability !== UPDATE_AVAILABLE) return () => {};

  // Forçage serveur : installé < minimum → IMMEDIATE bloquante.
  const current = Number.parseInt(info.currentVersionCode, 10);
  const minRequired = await fetchMinVersionCode();
  const forced =
    minRequired > 0 && Number.isFinite(current) && current < minRequired;

  if (forced && info.immediateUpdateAllowed) {
    try {
      await AppUpdate.performImmediateUpdate();
    } catch (err) {
      console.warn("[app-update] immediate update failed:", err);
    }
    return () => {};
  }

  if (!info.flexibleUpdateAllowed) return () => {};
  // Proposition douce : pas plus d'une fois par 24 h (sauf forçage, traité
  // au-dessus).
  if (!forced && recentlyPrompted()) return () => {};

  let listener: { remove: () => Promise<void> } | null = null;
  try {
    listener = await AppUpdate.addListener(
      "onFlexibleUpdateStateChange",
      (state) => {
        if (state.installStatus === STATUS_DOWNLOADED) onPhase("ready");
        else if (state.installStatus === STATUS_DOWNLOADING)
          onPhase("downloading");
        else if (
          state.installStatus === STATUS_FAILED ||
          state.installStatus === STATUS_CANCELED
        ) {
          void listener?.remove();
        }
      }
    );
    markPrompted();
    await AppUpdate.startFlexibleUpdate();
  } catch (err) {
    console.warn("[app-update] flexible update failed:", err);
    void listener?.remove();
    return () => {};
  }

  return () => {
    void listener?.remove();
  };
}

/** Redémarre l'app pour installer l'update flexible téléchargée (CTA bannière). */
export async function completeFlexibleUpdate(): Promise<void> {
  const mod = await loadPlugin();
  if (!mod) return;
  try {
    await mod.AppUpdate.completeFlexibleUpdate();
  } catch (err) {
    console.warn("[app-update] completeFlexibleUpdate failed:", err);
  }
}
