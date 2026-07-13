import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeImage, cropResize } from "@/lib/idv/pipeline/image";
import { getIdvSession } from "@/lib/idv/pipeline/onnx";
import { detectFaces } from "@/lib/idv/pipeline/yunet";
import { embedFace, SFACE_INPUT_SIZE } from "@/lib/idv/pipeline/sface";
import { passiveLivenessScore } from "@/lib/idv/pipeline/antispoof";
import type {
  AnalyzeSelfieRequest,
  AnalyzeSelfieResponse,
  AnalyzedFrame,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// POST /api/idv/analyze-selfie — CALCUL pur par frame (étape 6) : meilleur
// visage (YuNet) + embedding SFace. Le JUGEMENT (défis, cohérence, policy)
// vit dans l'action appelante via lib/idv/liveness.ts — cette route ne sait
// même pas quels défis étaient demandés.
// INTERNE UNIQUEMENT (Bearer INTERNAL_IDV_SECRET). Aucune écriture.
// =============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "idv-captures";
const MAX_FRAMES = 5;

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
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  let body: AnalyzeSelfieRequest;
  try {
    body = (await req.json()) as AnalyzeSelfieRequest;
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      throw new Error("paths manquants");
    }
    if (body.paths.length > MAX_FRAMES) throw new Error("trop de frames");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "corps invalide" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { session: yunet } = await getIdvSession("yunet");
  const { session: sface } = await getIdvSession("sface");
  // Anti-spoof passif : dégradé NON bloquant (si le modèle manque, on renvoie
  // null et l'action traite le contrôle comme « non exécuté »).
  const minifasnet = await getIdvSession("minifasnet").catch(() => null);

  const frames: AnalyzedFrame[] = [];
  for (const path of body.paths) {
    try {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`téléchargement : ${path}`);
      const raw = await decodeImage(Buffer.from(await data.arrayBuffer()), 960);
      const faces = await detectFaces(yunet, raw, { scoreThreshold: 0.6 });
      const best = faces[0] ?? null;
      if (!best) {
        frames.push({ face: null, embedding: null, passiveLiveness: null });
        continue;
      }
      const crop = await cropResize(raw, best, SFACE_INPUT_SIZE);
      const embedding = await embedFace(sface, crop);
      let passiveLiveness: number | null = null;
      if (minifasnet) {
        passiveLiveness = await passiveLivenessScore(
          minifasnet.session,
          raw,
          best
        ).catch(() => null);
      }
      frames.push({
        passiveLiveness,
        face: {
          x: Math.round(best.x),
          y: Math.round(best.y),
          w: Math.round(best.w),
          h: Math.round(best.h),
          score: Math.round(best.score * 1000) / 1000,
          landmarks: best.landmarks.map(
            ([x, y]) => [Math.round(x), Math.round(y)] as [number, number]
          ),
          imageW: raw.width,
          imageH: raw.height,
        },
        embedding: Array.from(embedding, (v) => Math.round(v * 1e5) / 1e5),
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 502 }
      );
    }
  }

  const res: AnalyzeSelfieResponse = { ok: true, frames };
  return NextResponse.json(res);
}
