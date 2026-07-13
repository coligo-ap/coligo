import sharp from "sharp";
import { Tensor, type InferenceSession } from "onnxruntime-node";

// =============================================================================
// IDV — détection de visages YuNet (opencv_zoo, licence MIT).
// L'ONNX 2023mar a une entrée FIXE 640×640 (vérifié au banc) : l'image est
// letterboxée (échelle conservée, coin haut-gauche, fond noir) puis les
// boîtes sont remappées vers les pixels d'origine. Post-traitement fidèle à
// cv::FaceDetectorYN : BGR brut 0-255, têtes cls/obj/bbox/kps par stride
// {8,16,32}, score = √(cls·obj), décodage centre+log-taille, NMS.
// Module AUTO-CONTENU (session injectée) → testé par test-idv-pipeline.mjs.
// =============================================================================

export type YuNetFace = {
  /** Boîte englobante en pixels image (clampée). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Confiance ∈ [0,1]. */
  score: number;
  /** 5 repères : œil droit, œil gauche, nez, bouche droite, bouche gauche. */
  landmarks: [number, number][];
};

const STRIDES = [8, 16, 32] as const;

type RawLike = { data: Uint8Array; width: number; height: number };

/** Trouve la sortie d'une tête (« cls_8 », « obj_16 »…) avec tolérance de
 *  nommage, ou échoue en LISTANT les sorties réelles (diagnostic immédiat). */
function findOutput(
  names: readonly string[],
  head: string,
  stride: number
): string {
  const re = new RegExp(`(^|[._/])${head}_?${stride}$`, "i");
  const hit = names.find((n) => re.test(n));
  if (!hit) {
    throw new Error(
      `YuNet : sortie ${head}_${stride} introuvable — sorties du modèle : ${names.join(", ")}`
    );
  }
  return hit;
}

function iou(a: YuNetFace, b: YuNetFace): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Dimensions d'entrée du modèle (H, W) — lues des métadonnées si exposées,
 *  sinon 640×640 (entrée fixe de l'ONNX 2023mar, vérifiée au banc). */
function modelInputSize(session: InferenceSession): [number, number] {
  const meta = (
    session as unknown as {
      inputMetadata?: { shape?: readonly (number | string)[] }[];
    }
  ).inputMetadata?.[0]?.shape;
  if (
    Array.isArray(meta) &&
    meta.length === 4 &&
    typeof meta[2] === "number" &&
    meta[2] > 0 &&
    typeof meta[3] === "number" &&
    meta[3] > 0
  ) {
    return [meta[2], meta[3]];
  }
  return [640, 640];
}

export async function detectFaces(
  session: InferenceSession,
  raw: RawLike,
  opts: { scoreThreshold?: number; nmsThreshold?: number; topK?: number } = {}
): Promise<YuNetFace[]> {
  const scoreThreshold = opts.scoreThreshold ?? 0.7;
  const nmsThreshold = opts.nmsThreshold ?? 0.3;
  const topK = opts.topK ?? 50;

  // Letterbox vers l'entrée fixe du modèle : échelle conservée, image au coin
  // haut-gauche, reste noir → remap final = division par `scale`.
  const [inH, inW] = modelInputSize(session);
  const scale = Math.min(inW / raw.width, inH / raw.height);
  const rw = Math.max(1, Math.round(raw.width * scale));
  const rh = Math.max(1, Math.round(raw.height * scale));
  const { data: resized } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .resize(rw, rh, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // RGB interleavé → BGR planaire float32 (convention OpenCV, valeurs brutes).
  const plane = inW * inH;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const src = (y * rw + x) * 3;
      const dst = y * inW + x;
      input[dst] = resized[src + 2]; // B
      input[plane + dst] = resized[src + 1]; // G
      input[2 * plane + dst] = resized[src]; // R
    }
  }

  const feeds: Record<string, Tensor> = {
    [session.inputNames[0]]: new Tensor("float32", input, [1, 3, inH, inW]),
  };
  const out = await session.run(feeds);
  const padW = inW;
  const padH = inH;

  const candidates: YuNetFace[] = [];
  for (const stride of STRIDES) {
    const cls = out[findOutput(session.outputNames, "cls", stride)]
      .data as Float32Array;
    const obj = out[findOutput(session.outputNames, "obj", stride)]
      .data as Float32Array;
    const bbox = out[findOutput(session.outputNames, "bbox", stride)]
      .data as Float32Array;
    const kps = out[findOutput(session.outputNames, "kps", stride)]
      .data as Float32Array;

    const cols = Math.floor(padW / stride);
    const rows = Math.floor(padH / stride);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const clsScore = Math.min(Math.max(cls[i], 0), 1);
        const objScore = Math.min(Math.max(obj[i], 0), 1);
        const score = Math.sqrt(clsScore * objScore);
        if (score < scoreThreshold) continue;

        // Décodage en espace modèle (640×640) puis remap vers l'image
        // d'origine (letterbox coin haut-gauche ⇒ simple division).
        const cx = ((c + bbox[i * 4]) * stride) / scale;
        const cy = ((r + bbox[i * 4 + 1]) * stride) / scale;
        const w = (Math.exp(bbox[i * 4 + 2]) * stride) / scale;
        const h = (Math.exp(bbox[i * 4 + 3]) * stride) / scale;
        const landmarks: [number, number][] = [];
        for (let k = 0; k < 5; k++) {
          landmarks.push([
            ((c + kps[i * 10 + k * 2]) * stride) / scale,
            ((r + kps[i * 10 + k * 2 + 1]) * stride) / scale,
          ]);
        }
        const x = Math.max(0, cx - w / 2);
        const y = Math.max(0, cy - h / 2);
        candidates.push({
          x,
          y,
          w: Math.min(w, raw.width - x),
          h: Math.min(h, raw.height - y),
          score,
          landmarks,
        });
      }
    }
  }

  // NMS glouton par score décroissant.
  candidates.sort((a, b) => b.score - a.score);
  const kept: YuNetFace[] = [];
  for (const cand of candidates) {
    if (kept.length >= topK) break;
    if (kept.every((k) => iou(k, cand) < nmsThreshold)) kept.push(cand);
  }
  return kept;
}
