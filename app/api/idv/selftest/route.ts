import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runIdvSelftest } from "@/lib/idv/pipeline/service";

// =============================================================================
// POST /api/idv/selftest — auto-diagnostic du pipeline ML IDV : charge les
// modèles, exécute une inférence réelle (image en base64 optionnelle, sinon
// bruit synthétique) et renvoie les mesures (cold start, chargement,
// inférence, mémoire).
//
// INTERNE UNIQUEMENT : Bearer INTERNAL_IDV_SECRET (comparaison à temps
// constant). Aucune donnée persistée, aucune écriture — sonde de santé.
// =============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.INTERNAL_IDV_SECRET) {
    return NextResponse.json(
      { error: "INTERNAL_IDV_SECRET non configuré" },
      { status: 503 }
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let imageBase64: string | undefined;
  try {
    const body = (await req.json()) as { imageBase64?: string };
    if (typeof body.imageBase64 === "string" && body.imageBase64.length > 0) {
      // Sonde interne : borne dure quand même (≈ 7,5 Mo décodés).
      if (body.imageBase64.length > 10_000_000) {
        return NextResponse.json(
          { error: "image trop lourde" },
          { status: 413 }
        );
      }
      imageBase64 = body.imageBase64;
    }
  } catch {
    /* corps vide accepté → bench synthétique */
  }

  try {
    return NextResponse.json(await runIdvSelftest(imageBase64));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
