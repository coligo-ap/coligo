"use client";

// =============================================================================
// downloadFile — téléchargement « EN DUR » d'un fichier authentifié, fiable
// PARTOUT. Bug vécu : un <a target="_blank"> vers /api/pdf/… dans la WebView
// Capacitor est intercepté (window.open muet / deep-link) et retombe sur
// l'écran d'accueil de l'app au lieu de télécharger. Ici :
//   1. fetch même-origine (cookies de session inclus) → Blob ;
//   2. APK : plugin Filesystem → fichier écrit dans Documents, puis feuille
//      Share système (l'utilisateur l'ouvre/l'enregistre où il veut) ;
//   3. Navigateur : <a download> sur un object URL → téléchargement direct,
//      sans onglet, sans navigation.
// Même patron de résolution des plugins que order-share-card (vieil APK sans
// plugin ⇒ repli navigateur).
// =============================================================================

import { isNative } from "@/lib/native/context";

type CapFilesystem = {
  writeFile: (o: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<{ uri: string }>;
};
type CapShare = { share: (o: object) => Promise<unknown> };

function capPlugins(): { Share?: CapShare; Filesystem?: CapFilesystem } {
  if (typeof window === "undefined" || !isNative()) return {};
  const plugins = (
    window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }
  ).Capacitor?.Plugins;
  return {
    Share: plugins?.Share as CapShare | undefined,
    Filesystem: plugins?.Filesystem as CapFilesystem | undefined,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export type DownloadResult = { ok: true } | { ok: false; error: string };

export async function downloadFile(
  url: string,
  filename: string
): Promise<DownloadResult> {
  let blob: Blob;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    blob = await res.blob();
  } catch {
    return { ok: false, error: "network" };
  }

  const { Filesystem, Share } = capPlugins();
  if (Filesystem) {
    try {
      const data = await blobToBase64(blob);
      const { uri } = await Filesystem.writeFile({
        path: filename,
        data,
        directory: "DOCUMENTS",
        recursive: true,
      });
      if (Share) {
        try {
          await Share.share({ title: filename, url: uri });
        } catch {
          /* feuille fermée par l'utilisateur : le fichier est déjà écrit */
        }
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "filesystem" };
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return { ok: true };
}
