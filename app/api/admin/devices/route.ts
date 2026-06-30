import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDevicesData } from "@/lib/data/admin-devices";

/**
 * GET /api/admin/devices — appareils + IP partagées + IP bloquées pour le cache
 * TanStack Query (réaffichage instantané au retour de nav, recherche client).
 * Gardé isSuperAdmin.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getDevicesData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
