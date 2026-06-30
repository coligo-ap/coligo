import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getAdminAlerts } from "@/lib/data/admin-alerts";

/**
 * GET /api/admin/alerts — alertes super-admin live (rafraîchies par le provider
 * TanStack côté drawer/cloche). Double garde : `isSuperAdmin()` ici (403 JSON,
 * pas de redirect pour ne pas casser le fetch) ET la RPC `admin_alerts()`
 * elle-même gardée en base (mig 0274). Lecture seule, agrégats sans PII.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const alerts = await getAdminAlerts();
  return NextResponse.json(alerts, {
    headers: { "Cache-Control": "no-store" },
  });
}
