import { getIdvSession, idvRuntimeWarm } from "@/lib/idv/pipeline/onnx";
import {
  decodeImage,
  cropResize,
  type RawImage,
} from "@/lib/idv/pipeline/image";
import { detectFaces, type YuNetFace } from "@/lib/idv/pipeline/yunet";
import {
  cosineSimilarity,
  embedFace,
  SFACE_INPUT_SIZE,
  SFACE_EMBEDDING_DIM,
} from "@/lib/idv/pipeline/sface";

// =============================================================================
// IDV — orchestrateur du pipeline ML (serveur uniquement). Étape 3 : selftest
// mesurable (chargement, inférences, mémoire) avec image réelle optionnelle.
// Les analyses métier (document, selfie, face match) s'appuieront dessus aux
// étapes 5-7.
// =============================================================================

export type IdvSelftestResult = {
  ok: boolean;
  coldStart: boolean;
  totalMs: number;
  rssMb: number;
  yunet: {
    loadMs: number;
    inferMs: number;
    /** Détections sur l'image fournie (0 attendu sur bruit synthétique). */
    detections: number;
    topFace: (Omit<YuNetFace, "landmarks"> & { landmarks: number }) | null;
  };
  sface: {
    loadMs: number;
    inferMs: number;
    dim: number;
    /** cos(v, v) — doit valoir ~1 (sanité numérique). */
    selfSimilarity: number;
  };
};

/** Bruit pseudo-aléatoire déterministe (xorshift) — bench reproductible. */
function syntheticImage(width: number, height: number): RawImage {
  const data = new Uint8Array(width * height * 3);
  let s = 0x12345678;
  for (let i = 0; i < data.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = s & 0xff;
  }
  return { data, width, height };
}

export async function runIdvSelftest(
  imageBase64?: string
): Promise<IdvSelftestResult> {
  const coldStart = !idvRuntimeWarm();
  const t0 = performance.now();

  const image = imageBase64
    ? await decodeImage(Buffer.from(imageBase64, "base64"))
    : syntheticImage(640, 480);

  const yunet = await getIdvSession("yunet");
  let t = performance.now();
  const faces = await detectFaces(yunet.session, image);
  const yunetInferMs = Math.round(performance.now() - t);

  const sface = await getIdvSession("sface");
  // Crop du meilleur visage détecté, sinon centre de l'image (bench).
  const box = faces[0] ?? {
    x: (image.width - SFACE_INPUT_SIZE) / 2,
    y: (image.height - SFACE_INPUT_SIZE) / 2,
    w: SFACE_INPUT_SIZE,
    h: SFACE_INPUT_SIZE,
  };
  const crop = await cropResize(image, box, SFACE_INPUT_SIZE);
  t = performance.now();
  const embedding = await embedFace(sface.session, crop);
  const sfaceInferMs = Math.round(performance.now() - t);

  const top = faces[0] ?? null;
  return {
    ok: true,
    coldStart,
    totalMs: Math.round(performance.now() - t0),
    rssMb: Math.round(process.memoryUsage().rss / 1e6),
    yunet: {
      loadMs: yunet.loadMs,
      inferMs: yunetInferMs,
      detections: faces.length,
      topFace: top
        ? {
            x: Math.round(top.x),
            y: Math.round(top.y),
            w: Math.round(top.w),
            h: Math.round(top.h),
            score: Math.round(top.score * 1000) / 1000,
            landmarks: top.landmarks.length,
          }
        : null,
    },
    sface: {
      loadMs: sface.loadMs,
      inferMs: sfaceInferMs,
      dim: SFACE_EMBEDDING_DIM,
      selfSimilarity:
        Math.round(cosineSimilarity(embedding, embedding) * 1000) / 1000,
    },
  };
}
