import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getAllMerchantsForAdmin } from "@/lib/data/platform";

/**
 * GET /api/admin/merchants — annuaire commerçant pour le cache TanStack Query
 * (réaffichage instantané au retour de navigation + rafraîchissement silencieux).
 * Gardé isSuperAdmin (la RPC sous-jacente est elle aussi SECURITY DEFINER gardée).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const merchants = await getAllMerchantsForAdmin();
  return NextResponse.json(merchants, {
    headers: { "Cache-Control": "no-store" },
  });
}
