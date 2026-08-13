import { APP_CONFIG } from "@/lib/config/app-config";
import { rateHit, logSecurityEvent } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-context";

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

  // Anti-abus (mig 0452) : chaque téléchargement relaie ~50 Mo depuis Supabase
  // — sans limite, un script peut brûler la bande passante en boucle. Un
  // humain télécharge 1 à 3 fois ; on tolère large (réinstallations, CGNAT).
  const ip = await getClientIp();
  const [hourGate, dayGate] = await Promise.all([
    rateHit("apk_ip_h", ip, 10, 3600),
    rateHit("apk_ip_d", ip, 30, 86400),
  ]);
  if (!hourGate.allowed || !dayGate.allowed) {
    await logSecurityEvent("rate_limited", {
      bucket: "apk_ip",
      subject: role,
      path: "/api/app-download",
    });
    return new Response("Trop de téléchargements. Réessayez plus tard.", {
      status: 429,
      headers: {
        "Retry-After": String(
          Math.max(hourGate.retryAfterSeconds, dayGate.retryAfterSeconds)
        ),
      },
    });
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
