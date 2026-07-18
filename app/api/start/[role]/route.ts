/**
 * Point d'entrée des apps natives — URL de démarrage DYNAMIQUE.
 *
 * Chaque APK ouvre `…/api/start/<role>` (au lieu d'un chemin gravé comme
 * `/driver`). Ici on redirige vers la page d'atterrissage du rôle, surchargeable
 * par variable d'env Vercel (`APP_LANDING_<ROLE>`) — donc on peut changer où
 * l'app atterrit SANS rebuilder l'APK. Sous /api → neutre vis-à-vis de
 * l'isolation des rôles (toutes sessions passent).
 *
 * role ∈ { client, commerce, driver, drive }.
 */
import { NATIVE_COOKIE, NATIVE_COOKIE_MAX_AGE } from "@/lib/config/native";

export const dynamic = "force-dynamic";

/**
 * Edge, PAS Node. C'est la toute première requête que fait l'APK au lancement,
 * et elle ne fait qu'une redirection : lire une variable d'env et renvoyer un
 * 307. En lambda Node elle payait un démarrage à froid — mesuré sur coligo-dev :
 * 2,08 s à froid contre 0,25 s à chaud. Deux secondes d'écran vide avant même
 * que la vraie page ne commence à charger, et les testeurs ouvrent l'app trop
 * rarement pour que la lambda reste chaude.
 *
 * À l'edge : pas de démarrage à froid, et le 307 part du POP le plus proche.
 * Aucune dépendance Node ici (ni Supabase, ni fs) — juste process.env et Response.
 */
export const runtime = "edge";

const DEFAULT_LANDING: Record<string, string> = {
  client: "/",
  commerce: "/dashboard",
  driver: "/driver",
  drive: "/chauffeur",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ role: string }> }
) {
  const { role } = await params;
  const landing =
    process.env[`APP_LANDING_${role.toUpperCase()}`] ||
    DEFAULT_LANDING[role] ||
    "/";

  const headers = new Headers({
    Location: new URL(landing, req.url).toString(),
  });

  // Marque le WebView des apps. `; wv)` = WebView Android (posé par Chrome) ;
  // `ColigoApp` = marqueur appendUserAgent de l'app iOS (le WKWebView est
  // sinon indiscernable de Safari — bug vécu : bannières web servies dans
  // l'app iOS). On évite ainsi de marquer un navigateur qui ouvrirait cette
  // URL à la main. Voir lib/config/native.ts.
  const ua = req.headers.get("user-agent") ?? "";
  if (/;\s*wv\)|ColigoApp/i.test(ua)) {
    headers.append(
      "Set-Cookie",
      `${NATIVE_COOKIE}=1; Path=/; Max-Age=${NATIVE_COOKIE_MAX_AGE}; SameSite=Lax; Secure`
    );
  }

  // `Response.redirect()` renvoie des en-têtes immuables : impossible d'y
  // ajouter un Set-Cookie. On construit la réponse à la main.
  return new Response(null, { status: 307, headers });
}
