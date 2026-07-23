import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeImage } from "@/lib/idv/pipeline/image";
import { getIdvSession } from "@/lib/idv/pipeline/onnx";
import {
  describeFace,
  findBestFace,
  findFaceUpright,
} from "@/lib/idv/pipeline/face-embed";
import {
  faceViewWeight,
  hammingDistance,
  REPLAY_HAMMING_MAX,
  type FaceQuality,
} from "@/lib/idv/pipeline/face-quality";
import {
  buildFaceTemplate,
  cosine,
  normalizeFaceScore,
} from "@/lib/idv/face-match";
import type {
  FaceMatchRequest,
  FaceMatchResponse,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// POST /api/idv/face-match — comparaison PORTRAIT DU DOCUMENT ↔ SELFIE.
//
// Trois principes, tirés du terrain et vérifiés au banc sur 13 identités réelles
// (scripts/test-idv-calibration.mjs) :
//
// 1. On compare des visages RECALÉS (alignement 5 points), pas des rectangles.
//    SFace a été entraîné sur des visages recalés : lui donner un cadrage brut,
//    c'est le juger sur l'inclinaison de la tête autant que sur l'identité.
//
// 2. On construit un GABARIT à partir de TOUTES les vues du selfie, pondérées
//    par ce qu'elles apportent (netteté × résolution × frontalité) — et non « la
//    meilleure vue », qui flattait aussi les imposteurs (le maximum de N tirages
//    monte pour tout le monde). Le gabarit remonte le pire cas légitime
//    (0.322 → 0.365) sans remonter l'imposteur.
//
// 3. On répond à une question que l'identité ne peut pas trancher : « ce selfie
//    n'est-il pas simplement la photo du document ? » — empreinte perceptuelle
//    des deux visages recalés. Un cosinus parfait obtenu par copier-coller n'est
//    pas une vérification.
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

async function load(path: string, maxSide = 1280) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`téléchargement impossible : ${path}`);
  return decodeImage(Buffer.from(await data.arrayBuffer()), maxSide);
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
    const doc = await describeFace(sface, docFace);

    // ── Vues du selfie : la frame de référence, puis les défis ──────────────
    const views = [
      body.selfiePath,
      ...(body.framePaths ?? []).filter((p) => p !== body.selfiePath),
    ].slice(0, MAX_SELFIE_VIEWS);

    const scored: {
      embedding: number[];
      weight: number;
      cosine: number;
      hash: bigint;
      quality: FaceQuality;
      rival: number;
    }[] = [];

    for (const path of views) {
      const image = await load(path, 960);
      const found = await findFaceUpright(yunet, image);
      if (!found) continue;
      const { embedding, quality, hash } = await describeFace(sface, {
        image,
        face: found.face,
        pass: found.pass,
        rival: found.rival,
      });
      const vector = Array.from(embedding);
      scored.push({
        embedding: vector,
        weight: faceViewWeight(quality),
        cosine: cosine(Array.from(doc.embedding), vector),
        hash,
        quality,
        rival: found.rival,
      });
    }

    if (scored.length === 0) {
      const res: FaceMatchResponse = {
        ok: true,
        score: 0,
        cosine: -1,
        docFaceFound: true,
        selfieFaceFound: false,
        docPass: docFace.pass,
        docQuality: doc.quality,
        docRival: docFace.rival,
      };
      return NextResponse.json(res);
    }

    // ── Gabarit d'identité : moyenne PONDÉRÉE des vues, re-normalisée ───────
    const template = buildFaceTemplate(scored);
    const templateCosine = template
      ? cosine(Array.from(doc.embedding), template)
      : Math.max(...scored.map((v) => v.cosine));

    // ── « Ce selfie EST-IL le portrait du document ? » ──────────────────────
    // On compare l'image, pas l'identité : la vue la PLUS proche en pixels fait
    // foi (il suffit d'une frame rejouée pour trahir la manœuvre).
    const replayDistance = Math.min(
      ...scored.map((v) => hammingDistance(doc.hash, v.hash))
    );

    // La vue de meilleure qualité représente le selfie dans le dossier de revue.
    const bestView = scored.reduce((a, b) => (b.weight > a.weight ? b : a));

    const res: FaceMatchResponse = {
      ok: true,
      score: normalizeFaceScore(templateCosine),
      cosine: Math.round(templateCosine * 10000) / 10000,
      docFaceFound: true,
      selfieFaceFound: true,
      framesCompared: scored.length,
      docPass: docFace.pass,
      docQuality: doc.quality,
      selfieQuality: bestView.quality,
      viewCosines: scored.map((v) => Math.round(v.cosine * 10000) / 10000),
      replayDistance,
      replaySuspected: replayDistance <= REPLAY_HAMMING_MAX,
      docRival: docFace.rival,
      selfieRival: Math.max(...scored.map((v) => v.rival)),
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
