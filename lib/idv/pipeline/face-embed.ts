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
import {
  assessFaceQuality,
  faceDHash,
  type FaceQuality,
} from "@/lib/idv/pipeline/face-quality";

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
  /**
   * Aire du 2e visage le plus grand, RELATIVE au principal (0 = il n'y en a pas).
   *
   * Ce n'est pas un détail : si deux visages se disputent la photo, « le plus
   * grand » n'est plus une réponse, c'est un pari. Un complice à côté de
   * l'objectif, ou le portrait d'un tiers brandi devant la caméra, et le
   * pipeline compare tranquillement le mauvais visage. Quand le doute existe,
   * il doit remonter jusqu'à la décision — pas être tranché en silence ici.
   */
  rival: number;
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

/** Part d'aire du deuxième visage par rapport au premier (0 si seul). */
function rivalRatio(faces: YuNetFace[], main: YuNetFace): number {
  let second = 0;
  for (const f of faces) {
    if (f === main) continue;
    second = Math.max(second, f.w * f.h);
  }
  const mainArea = main.w * main.h;
  if (mainArea <= 0) return 0;
  return Math.round((second / mainArea) * 1000) / 1000;
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
): Promise<{ face: YuNetFace; pass: string; rival: number } | null> {
  const minSide = opts.minSide ?? 40;
  const usable = (f: YuNetFace | null): f is YuNetFace =>
    f !== null && Math.min(f.w, f.h) >= minSide;

  const directAll = await detectFaces(yunet, image, { scoreThreshold: 0.6 });
  const direct = largest(directAll);
  if (usable(direct))
    return {
      face: direct,
      pass: "direct",
      rival: rivalRatio(directAll, direct),
    };

  // Contraste redressé : mêmes dimensions ⇒ repères directement valides.
  const enhanced = await enhanceForDetection(image);
  const enhancedAll = await detectFaces(yunet, enhanced, {
    scoreThreshold: 0.45,
  });
  const onEnhanced = largest(enhancedAll);
  if (usable(onEnhanced))
    return {
      face: onEnhanced,
      pass: "enhanced",
      rival: rivalRatio(enhancedAll, onEnhanced),
    };

  // Agrandissement ×2 (visage lointain, caméra basse définition) — on remappe.
  const big = await upscale(image, 2);
  const bigAll = await detectFaces(yunet, big, { scoreThreshold: 0.45 });
  const onBig = largest(bigAll);
  if (usable(onBig))
    return {
      face: rescale(onBig, 2),
      pass: "upscale2",
      rival: rivalRatio(bigAll, onBig),
    };

  // Plutôt un petit visage qu'un dossier vide : un score faible se relit en
  // revue humaine, une absence de visage ne se relit pas.
  if (direct)
    return {
      face: direct,
      pass: "direct_small",
      rival: rivalRatio(directAll, direct),
    };
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

  const directAll = await detectFaces(yunet, image, { scoreThreshold: 0.6 });
  const direct = largest(directAll);
  if (usable(direct))
    return {
      image,
      face: direct,
      pass: "direct",
      rival: rivalRatio(directAll, direct),
    };

  const enhanced = await enhanceForDetection(image);
  const enhancedAll = await detectFaces(yunet, enhanced, {
    scoreThreshold: 0.5,
  });
  const onEnhanced = largest(enhancedAll);
  if (usable(onEnhanced))
    return {
      image,
      face: onEnhanced,
      pass: "enhanced",
      rival: rivalRatio(enhancedAll, onEnhanced),
    };

  // Portrait de passeport minuscule : on agrandit pour DÉTECTER, mais on
  // recale ensuite sur les pixels d'origine (agrandir n'invente aucun détail).
  const big = await upscale(image, 2);
  const bigAll = await detectFaces(yunet, big, { scoreThreshold: 0.5 });
  const onBig = largest(bigAll);
  if (usable(onBig))
    return {
      image,
      face: rescale(onBig, 2),
      pass: "upscale2",
      rival: rivalRatio(bigAll, onBig),
    };

  for (const angle of [90, 270, 180] as const) {
    const rot = await rotateRaw(image, angle);
    const rotAll = await detectFaces(yunet, rot, { scoreThreshold: 0.6 });
    const onRot = largest(rotAll);
    if (usable(onRot))
      return {
        image: rot,
        face: onRot,
        pass: `rot${angle}`,
        rival: rivalRatio(rotAll, onRot),
      };
  }

  if (direct)
    return {
      image,
      face: direct,
      pass: "direct_small",
      rival: rivalRatio(directAll, direct),
    };
  return null;
}

/** Visage RECALÉ 112×112 — l'image exacte que verra le modèle. Repères
 *  inexploitables (visage au bord, détection dégénérée) ⇒ repli sur le
 *  recadrage de la boîte : moins précis, mais jamais d'échec. */
async function alignedCrop(found: FoundFace): Promise<RawImage> {
  const { image, face } = found;
  try {
    if (face.landmarks.length < 5) throw new Error("repères manquants");
    return alignFace(image, face.landmarks, ALIGN_SIZE);
  } catch {
    return cropResize(image, face, ALIGN_SIZE);
  }
}

/**
 * Embedding d'un visage RECALÉ : moyenne de l'embedding de l'image et de celui
 * de son miroir (« flip TTA », pratique standard : elle amortit les asymétries
 * d'éclairage et de pose, gratuitement).
 */
async function embedAligned(
  sface: InferenceSession,
  crop: RawImage
): Promise<Float32Array> {
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

/** Embedding d'un visage trouvé (chemin historique, conservé). */
export async function embedFoundFace(
  sface: InferenceSession,
  found: FoundFace
): Promise<Float32Array> {
  return embedAligned(sface, await alignedCrop(found));
}

/**
 * TOUT ce qu'on a besoin de savoir d'un visage, en UNE seule passe de recalage :
 *
 *   • qui c'est      → l'embedding (identité) ;
 *   • ce que ça vaut → la qualité (netteté, résolution, pose) : sans elle, on
 *     compare des visages qu'on ne voit pas, et un score sur du flou n'est pas
 *     une preuve, c'est un dé ;
 *   • quelle image   → l'empreinte perceptuelle, qui répond à une question que
 *     l'identité ne peut pas trancher : « ce selfie n'est-il pas tout simplement
 *     la photo du document ? »
 *
 * Les trois sortent du MÊME crop recalé : ce qu'on mesure est exactement ce que
 * le modèle regarde.
 */
export async function describeFace(
  sface: InferenceSession,
  found: FoundFace
): Promise<{
  embedding: Float32Array;
  quality: FaceQuality;
  hash: bigint;
}> {
  const crop = await alignedCrop(found);
  const [embedding, quality, hash] = [
    await embedAligned(sface, crop),
    assessFaceQuality(crop, found.face.landmarks),
    faceDHash(crop),
  ];
  return { embedding, quality, hash };
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
