import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getChauffeurRowsForAdmin } from "@/lib/data/admin-chauffeurs";

/**
 * GET /api/admin/chauffeurs — annuaire chauffeurs pour le cache TanStack Query
 * (réaffichage instantané au retour de nav). Gardé isSuperAdmin.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await getChauffeurRowsForAdmin();
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
