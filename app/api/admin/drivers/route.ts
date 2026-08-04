import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDriverRowsForAdmin } from "@/lib/data/admin-drivers";

/**
 * GET /api/admin/drivers?q=&limit=&offset= — annuaire livreurs PAGINÉ.
 *
 * Recherche et pagination EN BASE : on ne rapatrie plus tout l'annuaire pour
 * le filtrer côté navigateur — l'écran n'affiche qu'une poignée de lignes et
 * la recherche fait le travail. Gardé isSuperAdmin (service_role en interne).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const { rows, total } = await getDriverRowsForAdmin({
    q: url.searchParams.get("q"),
    limit: Number(url.searchParams.get("limit") ?? 20),
    offset: Number(url.searchParams.get("offset") ?? 0),
  });
  return NextResponse.json(
    { rows, total },
    { headers: { "Cache-Control": "no-store" } }
  );
}
