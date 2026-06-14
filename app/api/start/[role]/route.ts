/**
 * Point d'entrée des apps natives — URL de démarrage DYNAMIQUE.
 *
 * Chaque APK ouvre `…/api/start/<role>` (au lieu d'un chemin gravé comme
 * `/driver`). Ici on redirige vers la page d'atterrissage du rôle, surchargeable
 * par variable d'env Vercel (`APP_LANDING_<ROLE>`) — donc on peut changer où
 * l'app atterrit SANS rebuilder l'APK. Sous /api → neutre vis-à-vis de
 * l'isolation des rôles (toutes sessions passent).
 *
 * role ∈ { commerce, driver, drive }.
 */
export const dynamic = "force-dynamic";

const DEFAULT_LANDING: Record<string, string> = {
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
