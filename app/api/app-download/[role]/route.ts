import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Téléchargement des APK Coligo via une route MÊME-ORIGINE (sous /api, donc
 * neutre vis-à-vis de l'isolation des rôles → accessible à toutes les
 * sessions). Relaie le fichier hébergé (Supabase) en forçant
 * `Content-Disposition: attachment` sur NOTRE domaine → téléchargement fiable
 * partout (un lien cross-origin direct était bloqué en PWA/WebView).
 *
 * `role` ∈ { commerce, driver, drive }.
 */
export const dynamic = "force-dynamic";

const APPS: Record<string, { url: string; file: string }> = {
  commerce: { url: APP_CONFIG.merchantApk.url, file: "coligo-commercant.apk" },
  driver: { url: APP_CONFIG.driverApk.url, file: "coligo-livreur.apk" },
  drive: { url: APP_CONFIG.driveApk.url, file: "coligo-drive.apk" },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ role: string }> }
) {
  const { role } = await params;
  const app = APPS[role];
  if (!app?.url) {
    return new Response("Application non disponible.", { status: 404 });
  }

  const upstream = await fetch(app.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response("Application temporairement indisponible.", {
      status: 502,
    });
  }

  const headers = new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="${app.file}"`,
    "Cache-Control": "public, max-age=300",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new Response(upstream.body, { status: 200, headers });
}
