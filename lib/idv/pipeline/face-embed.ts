import type { InferenceSession } from "onnxruntime-node";
import {
  cropResize,
  enhanceForDetection,
  rotateRaw,
  upscale,
  type RawImage,
} from "@/lib/idv/pipeline/image";
import { detectFaces, type YuNetFace } from "@/lib/idv/pipeline/yunet";
import { alignFace, mirrorImage, ALIGN_SIZE } from "@/lib/idv/pipeline/align";
import { embedFace } from "@/lib/idv/pipeline/sface";

// =============================================================================
// IDV — TROUVER un visage, puis le RECONNAÎTRE, quelles que soient la caméra et
// les conditions. C'est ici que se joue la robustesse « terrain » du produit.
//
// Ce qu'on affronte réellement :
//   • le portrait d'un passeport photographié fait parfois 80-120 px de côté ;
//   • une photo prise le soir sort sous-exposée et plate ;
//   • un document est souvent tenu de travers, et certaines caméras n'écrivent
//     aucune orientation EXIF ;
//   • un selfie à bout de bras est incliné, jamais cadré comme un portrait.
//
// D'où une détection en CASCADE (on s'arrête au premier succès, donc on ne paie
// le prix des passes suivantes que quand la première a échoué), puis un
// embedding sur visage RECALÉ (lib/idv/pipeline/align.ts) avec moyenne de
// l'image et de son miroir — deux vues du même visage valent mieux qu'une.
// =============================================================================

export type FoundFace = {
  /** Variante de l'image où le visage a été trouvé (repères dans SES pixels). */
  image: RawImage;
  face: YuNetFace;
  /** Passe qui a réussi — remontée dans les métadonnées d'audit. */
  pass: string;
};

/** Aire de la boîte : sur un passeport, le portrait principal est le GRAND
 *  visage ; l'image fantôme (holographique) est plus petite. Trier par score
 *  seul nous ferait parfois reconnaître le fantôme, très dégradé. */
function largest(faces: YuNetFace[]): YuNetFace | null {
  let best: YuNetFace | null = null;
  for (const f of faces) {
    if (!best || f.w * f.h > best.w * best.h) best = f;
  }
  return best;
}

/** Ramène une boîte et ses repères d'une image agrandie vers l'échelle d'origine. */
function rescale(face: YuNetFace, factor: number): YuNetFace {
  return {
    x: face.x / factor,
    y: face.y / factor,
    w: face.w / factor,
    h: face.h / factor,
    score: face.score,
    landmarks: face.landmarks.map(
      ([x, y]) => [x / factor, y / factor] as [number, number]
    ),
  };
}

/**
 * SELFIE — visage cherché SANS rotation, et dont les repères restent exprimés
 * dans les pixels de l'image D'ORIGINE.
 *
 * C'est essentiel : les défis de présence (« tournez la tête à gauche ») se
 * jugent sur la GÉOMÉTRIE des repères. Un visage trouvé dans une image tournée
 * ou agrandie donnerait des coordonnées qui ne veulent plus rien dire — on
 * remappe donc systématiquement.
 */
export async function findFaceUpright(
  yunet: InferenceSession,
  image: RawImage,
  opts: { minSide?: number } = {}
): Promise<{ face: YuNetFace; pass: string } | null> {
  const minSide = opts.minSide ?? 40;
  const usable = (f: YuNetFace | null): f is YuNetFace =>
    f !== null && Math.min(f.w, f.h) >= minSide;

  const direct = largest(
    await detectFaces(yunet, image, { scoreThreshold: 0.6 })
  );
  if (usable(direct)) return { face: direct, pass: "direct" };

  // Contraste redressé : mêmes dimensions ⇒ repères directement valides.
  const enhanced = await enhanceForDetection(image);
  const onEnhanced = largest(
    await detectFaces(yunet, enhanced, { scoreThreshold: 0.45 })
  );
  if (usable(onEnhanced)) return { face: onEnhanced, pass: "enhanced" };

  // Agrandissement ×2 (visage lointain, caméra basse définition) — on remappe.
  const big = await upscale(image, 2);
  const onBig = largest(
    await detectFaces(yunet, big, { scoreThreshold: 0.45 })
  );
  if (usable(onBig)) return { face: rescale(onBig, 2), pass: "upscale2" };

  // Plutôt un petit visage qu'un dossier vide : un score faible se relit en
  // revue humaine, une absence de visage ne se relit pas.
  if (direct) return { face: direct, pass: "direct_small" };
  return null;
}

/**
 * DOCUMENT — on cherche le portrait, la géométrie n'a aucune importance : on
 * s'autorise donc aussi les quarts de tour (document photographié couché, sans
 * EXIF pour le dire) et on renvoie la variante d'image où le visage a été vu.
 */
export async function findBestFace(
  yunet: InferenceSession,
  image: RawImage,
  opts: { minSide?: number } = {}
): Promise<FoundFace | null> {
  const minSide = opts.minSide ?? 44;
  const usable = (f: YuNetFace | null): f is YuNetFace =>
    f !== null && Math.min(f.w, f.h) >= minSide;

  const direct = largest(
    await detectFaces(yunet, image, { scoreThreshold: 0.6 })
  );
  if (usable(direct)) return { image, face: direct, pass: "direct" };

  const enhanced = await enhanceForDetection(image);
  const onEnhanced = largest(
    await detectFaces(yunet, enhanced, { scoreThreshold: 0.5 })
  );
  if (usable(onEnhanced)) return { image, face: onEnhanced, pass: "enhanced" };

  // Portrait de passeport minuscule : on agrandit pour DÉTECTER, mais on
  // recale ensuite sur les pixels d'origine (agrandir n'invente aucun détail).
  const big = await upscale(image, 2);
  const onBig = largest(await detectFaces(yunet, big, { scoreThreshold: 0.5 }));
  if (usable(onBig))
    return { image, face: rescale(onBig, 2), pass: "upscale2" };

  for (const angle of [90, 270, 180] as const) {
    const rot = await rotateRaw(image, angle);
    const onRot = largest(
      await detectFaces(yunet, rot, { scoreThreshold: 0.6 })
    );
    if (usable(onRot)) return { image: rot, face: onRot, pass: `rot${angle}` };
  }

  if (direct) return { image, face: direct, pass: "direct_small" };
  return null;
}

/**
 * Embedding d'un visage TROUVÉ : recalage 5 points, puis moyenne de l'embedding
 * de l'image et de celui de son miroir (« flip TTA », pratique standard : elle
 * amortit les asymétries d'éclairage et de pose, gratuitement).
 *
 * Repères inexploitables (visage à l'extrême bord, détection dégénérée) ⇒ on
 * retombe sur le recadrage de la boîte : moins précis, mais jamais d'échec.
 */
export async function embedFoundFace(
  sface: InferenceSession,
  found: FoundFace
): Promise<Float32Array> {
  const { image, face } = found;

  let crop: { data: Uint8Array; width: number; height: number };
  try {
    if (face.landmarks.length < 5) throw new Error("repères manquants");
    crop = alignFace(image, face.landmarks, ALIGN_SIZE);
  } catch {
    crop = await cropResize(image, face, ALIGN_SIZE);
  }

  const [a, b] = await Promise.all([
    embedFace(sface, crop),
    embedFace(sface, mirrorImage(crop)),
  ]);

  const merged = new Float32Array(a.length);
  let norm = 0;
  for (let i = 0; i < a.length; i++) {
    merged[i] = a[i] + b[i];
    norm += merged[i] ** 2;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return a;
  for (let i = 0; i < merged.length; i++) merged[i] /= norm;
  return merged;
}

/** Trouve ET embarque, en une fois (null si aucun visage exploitable). */
export async function detectAndEmbed(
  yunet: InferenceSession,
  sface: InferenceSession,
  image: RawImage,
  opts: { minSide?: number } = {}
): Promise<{ embedding: Float32Array; found: FoundFace } | null> {
  const found = await findBestFace(yunet, image, opts);
  if (!found) return null;
  return { embedding: await embedFoundFace(sface, found), found };
}
