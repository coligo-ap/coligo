import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeImage } from "@/lib/idv/pipeline/image";
import { getIdvSession } from "@/lib/idv/pipeline/onnx";
import { detectFaces } from "@/lib/idv/pipeline/yunet";
import { ocrVisualZone, readMrz } from "@/lib/idv/pipeline/mrz-ocr";
import { extractFromVisualZone } from "@/lib/idv/doc-ocr";
import { parseMrz, type MrzResult } from "@/lib/idv/mrz";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  AnalyzedCheck,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// POST /api/idv/analyze-document — ANALYSE du document (étape 5) :
//   • doc_face : portrait présent sur le recto (YuNet) ;
//   • mrz      : lecture OCR + parsing + checksums ICAO 9303 ;
//   • doc_expiry : date d'expiration extraite de la MRZ ;
//   • ocr_extract : OCR généraliste PP-OCR — pas encore branché (permis).
// INTERNE UNIQUEMENT (Bearer INTERNAL_IDV_SECRET). Cette route vit dans
// /api/idv/** : c'est la fonction qui EMBARQUE les modèles (next.config).
// Aucune écriture : l'action appelante enregistre checks + décision.
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

async function download(path: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`téléchargement impossible : ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  let body: AnalyzeDocumentRequest;
  try {
    body = (await req.json()) as AnalyzeDocumentRequest;
    if (!body.frontPath) throw new Error("frontPath manquant");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "corps invalide" },
      { status: 400 }
    );
  }

  const checks: AnalyzedCheck[] = [];
  let extracted: Record<string, unknown> | null = null;
  let documentExpiresAt: string | null = null;

  let front: Buffer;
  let back: Buffer | null = null;
  try {
    front = await download(body.frontPath);
    if (body.backPath) back = await download(body.backPath);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "storage" },
      { status: 502 }
    );
  }

  // ── doc_face : un portrait doit exister sur le recto ──────────────────────
  try {
    const raw = await decodeImage(front, 1280);
    const { session } = await getIdvSession("yunet");
    // Portrait IMPRIMÉ (petit, tramé) : seuil plus tolérant que du live.
    const faces = await detectFaces(session, raw, { scoreThreshold: 0.6 });
    const best = faces[0] ?? null;
    checks.push({
      key: "doc_face",
      status: best ? "passed" : "failed",
      score: best ? Math.round(best.score * 1000) / 1000 : 0,
      retryable: !best,
      details: best
        ? {
            box: {
              x: Math.round(best.x),
              y: Math.round(best.y),
              w: Math.round(best.w),
              h: Math.round(best.h),
            },
          }
        : { reason: "no_face_on_document" },
    });
  } catch (e) {
    checks.push({
      key: "doc_face",
      status: "error",
      score: null,
      details: { error: e instanceof Error ? e.message : String(e) },
    });
  }

  // ── mrz + doc_expiry ───────────────────────────────────────────────────────
  if (!body.mrzFormat) {
    checks.push({ key: "mrz", status: "skipped", score: null });
    checks.push({ key: "doc_expiry", status: "skipped", score: null });
  } else {
    let parsed: MrzResult | null = null;
    let attempt: string | null = null;
    try {
      // TD1 (carte) : la MRZ vit au VERSO ; TD3 (passeport) : page photo.
      const source = body.mrzFormat === "td1" && back ? back : front;
      // Multi-passes (zones × prétraitements), sortie dès checksums valides.
      const read = await readMrz(source, body.mrzFormat, parseMrz);
      parsed = read.parsed;
      attempt = read.attempt;
      if (!parsed) {
        checks.push({
          key: "mrz",
          status: "failed",
          score: 0,
          retryable: true,
          details: { reason: "unreadable" },
        });
        checks.push({ key: "doc_expiry", status: "skipped", score: null });
      } else {
        checks.push({
          key: "mrz",
          status: parsed.valid ? "passed" : "failed",
          score: parsed.score,
          retryable: false,
          details: { checks: parsed.checks, format: parsed.format, attempt },
        });
        if (parsed.valid) {
          extracted = { ...parsed.fields, mrz_format: parsed.format };
          documentExpiresAt = parsed.fields.expiry_date;
          const today = new Date().toISOString().slice(0, 10);
          const expired =
            !parsed.fields.expiry_date || parsed.fields.expiry_date < today;
          checks.push({
            key: "doc_expiry",
            status: expired ? "failed" : "passed",
            score: expired ? 0 : 1,
            retryable: false,
            details: { expiry_date: parsed.fields.expiry_date },
          });
        } else {
          checks.push({ key: "doc_expiry", status: "skipped", score: null });
        }
      }
    } catch (e) {
      checks.push({
        key: "mrz",
        status: "error",
        score: null,
        details: { error: e instanceof Error ? e.message : String(e) },
      });
      checks.push({ key: "doc_expiry", status: "skipped", score: null });
    }
  }

  // ── ocr_extract : zone VISUELLE (permis — aucun MRZ à contrôler) ─────────
  // On ne l'exécute QUE si la MRZ n'a rien donné (document sans MRZ) : quand
  // une MRZ valide existe, elle fait foi (checksums) et l'OCR visuel
  // n'apporterait qu'un risque d'erreur.
  if (extracted) {
    checks.push({
      key: "ocr_extract",
      status: "skipped",
      score: null,
      details: { reason: "mrz_is_authoritative" },
    });
  } else {
    try {
      const text = await ocrVisualZone(front);
      const fields = extractFromVisualZone(text);
      const hasExpiry = Boolean(fields.expiry_date);
      checks.push({
        key: "ocr_extract",
        status: hasExpiry ? "passed" : "failed",
        score: hasExpiry ? 1 : 0,
        // Un permis illisible se REPREND (ce n'est pas un signal de fraude).
        retryable: !hasExpiry,
        details: {
          dates: fields.dates,
          document_number: fields.document_number,
        },
      });
      if (hasExpiry) {
        extracted = {
          expiry_date: fields.expiry_date,
          birth_date: fields.birth_date,
          document_number: fields.document_number,
          source: "visual_zone",
        };
        documentExpiresAt = fields.expiry_date;
        const today = new Date().toISOString().slice(0, 10);
        const expired = fields.expiry_date! < today;
        // Remplace le doc_expiry « skipped » posé plus haut (pas de MRZ).
        const idx = checks.findIndex((c) => c.key === "doc_expiry");
        const expiryCheck: AnalyzedCheck = {
          key: "doc_expiry",
          status: expired ? "failed" : "passed",
          score: expired ? 0 : 1,
          retryable: false,
          details: { expiry_date: fields.expiry_date, source: "visual_zone" },
        };
        if (idx >= 0) checks[idx] = expiryCheck;
        else checks.push(expiryCheck);
      }
    } catch (e) {
      checks.push({
        key: "ocr_extract",
        status: "error",
        score: null,
        details: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  const res: AnalyzeDocumentResponse = {
    ok: true,
    checks,
    extracted,
    documentExpiresAt,
  };
  return NextResponse.json(res);
}
