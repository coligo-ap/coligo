import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeImage, cropResize } from "@/lib/idv/pipeline/image";
import { getIdvSession } from "@/lib/idv/pipeline/onnx";
import { detectFaces } from "@/lib/idv/pipeline/yunet";
import {
  cosineSimilarity,
  embedFace,
  SFACE_INPUT_SIZE,
} from "@/lib/idv/pipeline/sface";
import { normalizeFaceScore } from "@/lib/idv/face-match";
import type {
  FaceMatchRequest,
  FaceMatchResponse,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// POST /api/idv/face-match — comparaison PORTRAIT DU DOCUMENT ↔ SELFIE
// (étape 7). Re-localise le portrait sur le recto (YuNet), embarque les deux
// visages (SFace) et renvoie le cosinus + un score NORMALISÉ [0,1] comparable
// aux seuils configurés par le super-admin. La DÉCISION reste dans l'action
// (moteur decideIdv). INTERNE UNIQUEMENT (Bearer). Aucune écriture.
// =============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "idv-captures";

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Meilleur visage d'une image du bucket → embedding SFace (ou null). */
async function embedBest(path: string): Promise<Float32Array | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`téléchargement impossible : ${path}`);
  const raw = await decodeImage(Buffer.from(await data.arrayBuffer()), 1280);
  const { session: yunet } = await getIdvSession("yunet");
  const faces = await detectFaces(yunet, raw, { scoreThreshold: 0.6 });
  const best = faces[0];
  if (!best) return null;
  const crop = await cropResize(raw, best, SFACE_INPUT_SIZE);
  const { session: sface } = await getIdvSession("sface");
  return embedFace(sface, crop);
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
    const [docEmb, selfieEmb] = await Promise.all([
      embedBest(body.docPath),
      embedBest(body.selfiePath),
    ]);
    if (!docEmb || !selfieEmb) {
      const res: FaceMatchResponse = {
        ok: true,
        score: 0,
        cosine: -1,
        docFaceFound: Boolean(docEmb),
        selfieFaceFound: Boolean(selfieEmb),
      };
      return NextResponse.json(res);
    }
    const cosine = cosineSimilarity(docEmb, selfieEmb);
    const res: FaceMatchResponse = {
      ok: true,
      score: normalizeFaceScore(cosine),
      cosine: Math.round(cosine * 10000) / 10000,
      docFaceFound: true,
      selfieFaceFound: true,
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
