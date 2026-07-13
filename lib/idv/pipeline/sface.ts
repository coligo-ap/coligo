import { Tensor, type InferenceSession } from "onnxruntime-node";

// =============================================================================
// IDV — embeddings de visage SFace (opencv_zoo, Apache-2.0), 128 dimensions.
// Prétraitement VÉRIFIÉ dans la source OpenCV (face_recognize.cpp) :
//   blobFromImage(aligned, scale=1, size=112×112, mean=(0,0,0), swapRB=true)
//   → le réseau mange du RGB BRUT 0-255 (sharp nous donne déjà du RGB),
//   et l'embedding est normalisé L2 avant la similarité cosinus.
// Module AUTO-CONTENU (session injectée). L'ALIGNEMENT 5 points (similarity
// transform) arrive à l'étape 7 — ici on embarque un crop 112×112 fourni.
// =============================================================================

export const SFACE_INPUT_SIZE = 112;
export const SFACE_EMBEDDING_DIM = 128;

type RawLike = { data: Uint8Array; width: number; height: number };

/** Embedding L2-normalisé d'un crop visage 112×112 RGB. */
export async function embedFace(
  session: InferenceSession,
  face: RawLike
): Promise<Float32Array> {
  if (face.width !== SFACE_INPUT_SIZE || face.height !== SFACE_INPUT_SIZE) {
    throw new Error(
      `SFace : crop ${face.width}×${face.height} — attendu ${SFACE_INPUT_SIZE}×${SFACE_INPUT_SIZE}`
    );
  }
  // RGB interleavé → RGB planaire float32 brut (cf. en-tête).
  const plane = SFACE_INPUT_SIZE * SFACE_INPUT_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = face.data[i * 3];
    input[plane + i] = face.data[i * 3 + 1];
    input[2 * plane + i] = face.data[i * 3 + 2];
  }
  // Les poids du modèle apparaissent aussi comme inputs du graphe (export
  // MXNet ancien, vu au banc) : ils ont des valeurs par défaut — on ne
  // nourrit que la VRAIE entrée (« data », sinon la première).
  const inputName =
    session.inputNames.find((n) => n === "data") ?? session.inputNames[0];
  const feeds: Record<string, Tensor> = {
    [inputName]: new Tensor("float32", input, [
      1,
      3,
      SFACE_INPUT_SIZE,
      SFACE_INPUT_SIZE,
    ]),
  };
  const out = await session.run(feeds);
  const embedding = out[session.outputNames[0]].data as Float32Array;
  if (embedding.length !== SFACE_EMBEDDING_DIM) {
    throw new Error(
      `SFace : embedding de ${embedding.length} dims (attendu ${SFACE_EMBEDDING_DIM})`
    );
  }
  // Normalisation L2 (comme OpenCV avant le score cosinus).
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) norm += embedding[i] ** 2;
  norm = Math.sqrt(norm);
  if (norm === 0) throw new Error("SFace : embedding nul");
  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++)
    normalized[i] = embedding[i] / norm;
  return normalized;
}

/** Similarité cosinus de deux embeddings DÉJÀ L2-normalisés (∈ [-1, 1]). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error("cosineSimilarity : dims ≠");
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
