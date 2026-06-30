import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDriverRowsForAdmin } from "@/lib/data/admin-drivers";

/**
 * GET /api/admin/drivers — annuaire livreurs pour le cache TanStack Query
 * (réaffichage instantané au retour de nav). Gardé isSuperAdmin (service_role
 * en interne, l'appelant est gaté).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await getDriverRowsForAdmin();
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
