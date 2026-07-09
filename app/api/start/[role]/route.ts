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
  return Response.redirect(new URL(landing, req.url), 307);
}
