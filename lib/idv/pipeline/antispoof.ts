import sharp from "sharp";
import { Tensor, type InferenceSession } from "onnxruntime-node";

// =============================================================================
// IDV — ANTI-SPOOF PASSIF (MiniFASNetV2, Apache-2.0, étape 6b).
// Détecte une PRÉSENTATION d'attaque sans rien demander à l'utilisateur :
// photo imprimée, photo affichée à l'écran, visage rejoué en vidéo.
//
// Conventions VÉRIFIÉES au banc (le dépôt d'origine les documente mal ; une
// conversion ONNX tierce circule avec des indications FAUSSES) :
//   • entrée : BGR **brut 0-255** (PAS de division par 255 — mesuré : /255
//     classe TOUT en attaque), planaire 1×3×80×80 ;
//   • crop CONTEXTUEL : boîte du visage élargie ×2.7 (c'est ce contexte qui
//     révèle le cadre d'un téléphone/d'une photo tenue devant l'objectif) ;
//   • sortie : 3 logits → softmax ; **l'indice 1 = VIVANT** (convention du
//     dépôt minivision : `label == 1 → real`).
// Mesures : vrai visage → p(vivant) ≈ 0.99 ; photo présentée avec son cadre →
// p(vivant) ≈ 0.00.
// =============================================================================

export const ANTISPOOF_INPUT = 80;
/** Élargissement de la boîte : le contexte (bord d'écran, cadre) fait foi. */
export const ANTISPOOF_CROP_SCALE = 2.7;
/**
 * Seuil « vivant » — MARGE VOLONTAIREMENT LARGE. Mesures : vrai visage plein
 * cadre ≈ 0.99, attaque de présentation ≈ 0.00 ; mais le modèle est TRÈS
 * sensible au contexte (une image bordée de noir fait chuter un vrai visage à
 * ~0.22). Comme un faux positif enverrait un utilisateur légitime en revue
 * humaine pour rien, on se cale au ras des attaques (qui sont à 0), pas au
 * milieu. À recalibrer sur des captures d'appareils RÉELS avant de durcir.
 */
export const ANTISPOOF_LIVE_MIN = 0.2;

type RawLike = { data: Uint8Array; width: number; height: number };
type Box = { x: number; y: number; w: number; h: number };

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

/**
 * Probabilité que le visage soit VIVANT (∈ [0,1]) sur cette frame.
 * `face` = boîte YuNet dans l'image `raw`.
 */
export async function passiveLivenessScore(
  session: InferenceSession,
  raw: RawLike,
  face: Box
): Promise<number> {
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  // Crop CARRÉ et ENTIÈREMENT dans l'image : on RÉDUIT le rayon plutôt que de
  // rogner un côté — un crop rectangulaire redimensionné en 80×80 déformerait
  // le visage et fausserait le modèle (mesuré : chute du score).
  const wanted = (Math.max(face.w, face.h) * ANTISPOOF_CROP_SCALE) / 2;
  const half = Math.floor(
    Math.min(wanted, cx, cy, raw.width - cx, raw.height - cy)
  );
  if (half < 8) throw new Error("anti-spoof : zone trop petite");
  const left = Math.round(cx - half);
  const top = Math.round(cy - half);
  const width = half * 2;
  const height = half * 2;

  const { data } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .extract({ left, top, width, height })
    .resize(ANTISPOOF_INPUT, ANTISPOOF_INPUT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const plane = ANTISPOOF_INPUT * ANTISPOOF_INPUT;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 3 + 2]; // B (brut 0-255)
    input[plane + i] = data[i * 3 + 1]; // G
    input[2 * plane + i] = data[i * 3]; // R
  }
  const out = await session.run({
    [session.inputNames[0]]: new Tensor("float32", input, [
      1,
      3,
      ANTISPOOF_INPUT,
      ANTISPOOF_INPUT,
    ]),
  });
  const logits = Array.from(out[session.outputNames[0]].data as Float32Array);
  const probs = softmax(logits);
  return Math.round(probs[1] * 1000) / 1000;
}
