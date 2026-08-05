import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getActiveFraudSanctions } from "@/lib/data/fraud-sanctions";
import { FRAUD_KINDS, type FraudActorKind } from "@/lib/fraud/model";

/**
 * GET /api/admin/fraud-sanctions?kind=&id= — sanctions anti-fraude ACTIVES
 * d'un compte, pour les fiches qui les chargent PARESSEUSEMENT (annuaire
 * commerçants : les lignes arrivent par « Voir plus », on ne précharge pas).
 * Gardé isSuperAdmin (service_role en interne).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!FRAUD_KINDS.includes(kind as FraudActorKind) || !id) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const sanctions = await getActiveFraudSanctions(kind as FraudActorKind, id);
  return NextResponse.json(
    { sanctions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
