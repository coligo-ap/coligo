import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getMerchantsForAdmin } from "@/lib/data/platform";

/**
 * GET /api/admin/merchants?q=&limit=&offset= — annuaire commerçant PAGINÉ
 * (mig 0429), pour le cache TanStack Query.
 *
 * La recherche et la pagination sont faites EN BASE : on ne rapatrie plus tout
 * l'annuaire pour le filtrer ensuite côté navigateur. Chaque ligne coûte une
 * somme sur `wallet_entries` — en charger 500 pour en montrer 3 n'a pas de sens.
 *
 * Gardé isSuperAdmin (la RPC sous-jacente est elle aussi SECURITY DEFINER gardée).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const { rows, total } = await getMerchantsForAdmin({
    search: url.searchParams.get("q"),
    limit: Number(url.searchParams.get("limit") ?? 3),
    offset: Number(url.searchParams.get("offset") ?? 0),
  });
  return NextResponse.json(
    { rows, total },
    { headers: { "Cache-Control": "no-store" } }
  );
}
