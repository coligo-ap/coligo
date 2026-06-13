import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Téléchargement de l'APK commerçant via une route MÊME-ORIGINE.
 *
 * Pourquoi ne pas pointer le bouton directement sur l'URL Supabase ?
 * L'attribut `download` d'un <a> est ignoré en cross-origin et certains
 * navigateurs/WebView (PWA standalone, navigateurs in-app) refusent ou
 * « bloquent » le téléchargement → la page tournait sans rien proposer.
 *
 * Ici on relaie le fichier depuis Supabase en forçant
 * `Content-Disposition: attachment` sur NOTRE domaine → le navigateur
 * télécharge le .apk de façon fiable, sans popup, en restant sur la page.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { url } = APP_CONFIG.merchantApk;
  if (!url) {
    return new Response("APK non disponible.", { status: 404 });
  }

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response("APK temporairement indisponible.", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="coligo-commercant.apk"',
    "Cache-Control": "public, max-age=300",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new Response(upstream.body, { status: 200, headers });
}
