import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeImage } from "@/lib/idv/pipeline/image";
import { getIdvSession } from "@/lib/idv/pipeline/onnx";
import { cosineSimilarity } from "@/lib/idv/pipeline/sface";
import {
  embedFoundFace,
  findBestFace,
  findFaceUpright,
} from "@/lib/idv/pipeline/face-embed";
import { normalizeFaceScore } from "@/lib/idv/face-match";
import type {
  FaceMatchRequest,
  FaceMatchResponse,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// POST /api/idv/face-match — comparaison PORTRAIT DU DOCUMENT ↔ SELFIE.
//
// Deux principes, tirés du terrain :
//
// 1. On compare des visages RECALÉS (alignement 5 points), pas des rectangles.
//    SFace a été entraîné sur des visages recalés : lui donner un cadrage brut,
//    c'est le juger sur l'inclinaison de la tête autant que sur l'identité. Le
//    recalage a doublé la marge entre « même personne » et « imposteur » au banc.
//
// 2. On compare TOUTES les vues du selfie, et la MEILLEURE fait foi. L'utilisateur
//    bouge pendant les défis : une frame est floue, une autre est nette. Refuser
//    quelqu'un sur sa plus mauvaise image serait injuste — et faux.
//
// La DÉCISION, elle, reste dans l'action (moteur decideIdv). Route INTERNE
// (Bearer INTERNAL_IDV_SECRET), aucune écriture.
// =============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "idv-captures";
/** Au-delà, on paierait des inférences pour un gain nul (les frames se ressemblent). */
const MAX_SELFIE_VIEWS = 5;

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function load(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`téléchargement impossible : ${path}`);
  return decodeImage(Buffer.from(await data.arrayBuffer()), 1280);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  let body: FaceMatchRequest;
  try {
    body = (await req.json()) as FaceMatchRequest;
    if (!body.docPath || !body.selfiePath) throw new Error("chemins manquants");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "corps invalide" },
      { status: 400 }
    );
  }

  try {
    const { session: yunet } = await getIdvSession("yunet");
    const { session: sface } = await getIdvSession("sface");

    // ── Portrait du document ────────────────────────────────────────────────
    const docImage = await load(body.docPath);
    const docFace = await findBestFace(yunet, docImage);
    if (!docFace) {
      const res: FaceMatchResponse = {
        ok: true,
        score: 0,
        cosine: -1,
        docFaceFound: false,
        selfieFaceFound: false,
      };
      return NextResponse.json(res);
    }
    const docEmbedding = await embedFoundFace(sface, docFace);

    // ── Vues du selfie : la frame de référence, puis les défis ──────────────
    const views = [
      body.selfiePath,
      ...(body.framePaths ?? []).filter((p) => p !== body.selfiePath),
    ].slice(0, MAX_SELFIE_VIEWS);

    let best: { cosine: number; pass: string } | null = null;
    let compared = 0;
    for (const path of views) {
      const image = await load(path);
      const found = await findFaceUpright(yunet, image);
      if (!found) continue;
      const embedding = await embedFoundFace(sface, {
        image,
        face: found.face,
        pass: found.pass,
      });
      const cosine = cosineSimilarity(docEmbedding, embedding);
      compared++;
      if (!best || cosine > best.cosine) best = { cosine, pass: found.pass };
    }

    if (!best) {
      const res: FaceMatchResponse = {
        ok: true,
        score: 0,
        cosine: -1,
        docFaceFound: true,
        selfieFaceFound: false,
        docPass: docFace.pass,
      };
      return NextResponse.json(res);
    }

    const res: FaceMatchResponse = {
      ok: true,
      score: normalizeFaceScore(best.cosine),
      cosine: Math.round(best.cosine * 10000) / 10000,
      docFaceFound: true,
      selfieFaceFound: true,
      framesCompared: compared,
      docPass: docFace.pass,
      selfiePass: best.pass,
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
