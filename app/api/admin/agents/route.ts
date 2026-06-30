import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { loadAgents } from "@/lib/data/admin-agents";

/**
 * GET /api/admin/agents — annuaire Agents Coligo Pay pour le cache TanStack
 * Query (réaffichage instantané au retour de nav). Gardé isSuperAdmin.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const agents = await loadAgents();
  return NextResponse.json(agents, {
    headers: { "Cache-Control": "no-store" },
  });
}
