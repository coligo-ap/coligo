// =============================================================================
// IDV — QUALITÉ BIOMÉTRIQUE d'un visage (module PUR : aucune dépendance, testé
// au banc sur des visages réels).
//
// POURQUOI CE MODULE EXISTE.
// Le pipeline savait dire « il y a un visage ». Il ne savait pas dire « ce
// visage est-il exploitable ». Or comparer deux visages sur une capture floue,
// minuscule ou noyée dans l'ombre, c'est jouer l'identité de quelqu'un aux dés :
// le modèle rend un score, mais ce score ne veut plus rien dire. Deux issues,
// toutes les deux fausses : refuser un livreur honnête, ou laisser passer un
// imposteur parce que le bruit a rapproché deux visages.
//
// La bonne réponse n'est ni l'un ni l'autre : c'est REDEMANDER une photo. D'où
// ce module, qui mesure ce que le modèle voit vraiment.
//
// MESURES (faites sur le visage RECALÉ 112×112, exactement l'image que reçoit
// SFace — mesurer sur la photo entière n'aurait aucun sens : c'est le visage
// qu'on reconnaît, pas le décor) :
//   • netteté   : variance du Laplacien ;
//   • lumière   : luminosité moyenne du visage ;
//   • résolution: écart inter-yeux en pixels NATIFS (la vraie information
//                 biométrique disponible — agrandir n'invente rien) ;
//   • pose      : yaw (nez vs milieu des yeux) après annulation du roll.
//
// SEUILS — mesurés sur le corpus réel (scripts/idv-measure-quality.mjs), pas
// devinés. Sur 13 identités, visage net de face :
//   netteté ≈ 1070 · lumière ≈ 105 · inter-yeux ≈ 83 px
// et en dégradant :
//   flou léger  → netteté 331, reconnaissance 0.98  (acceptable)
//   flou moyen  → netteté  73, reconnaissance 0.95  (à la limite)
//   flou fort   → netteté  14, reconnaissance 0.85  (REFUSÉ : on redemande)
//   très sombre → lumière  32, reconnaissance 0.90  (REFUSÉ)
//   très petit  → inter-yeux 30, reconnaissance 0.94 (limite basse)
// Les seuils sont posés SOUS les cas encore exploitables : on ne redemande une
// photo que quand elle est vraiment inutilisable.
// =============================================================================

export type RawLike = { data: Uint8Array; width: number; height: number };

export type FaceQualityReason =
  | "face_too_small"
  | "blurry"
  | "too_dark"
  | "too_bright"
  | "not_frontal";

/** Coaching utilisateur — jamais un refus : une mauvaise photo se reprend. */
export const FACE_QUALITY_REASONS_FR: Record<FaceQualityReason, string> = {
  face_too_small: "Rapprochez le téléphone : votre visage est trop petit",
  blurry: "Photo floue — restez immobile et refaites le selfie",
  too_dark: "Trop sombre — placez-vous face à une source de lumière",
  too_bright: "Trop de lumière — évitez le contre-jour direct",
  not_frontal: "Regardez bien l'objectif, de face",
};

// ── Seuils (mesurés, cf. en-tête) ───────────────────────────────────────────
/** Sous cet écart inter-yeux, il n'y a plus assez de pixels pour identifier. */
export const MIN_EYE_DIST = 30;
/** Variance du Laplacien sur le visage recalé : sous ce seuil, c'est du flou. */
export const MIN_SHARPNESS = 50;
export const BRIGHTNESS_RANGE: readonly [number, number] = [40, 200];
/** Au-delà, le visage est de profil : ce n'est plus une photo d'identité. */
export const MAX_YAW = 0.6;
/**
 * Part d'aire du 2e visage au-delà de laquelle l'identité devient AMBIGUË.
 *
 * Un passant au fond de la pièce occupe quelques pourcents du cadre : ce n'est
 * pas un problème. Un second visage qui fait la moitié du principal, si : c'est
 * soit quelqu'un juste à côté de l'objectif, soit un portrait brandi devant la
 * caméra. Dans les deux cas, « le plus grand visage » n'est plus une réponse —
 * c'est un pari sur l'identité de quelqu'un. Le dossier part en revue humaine.
 */
export const RIVAL_FACE_MAX = 0.5;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

export type FaceGeometry = {
  /** Écart inter-yeux en pixels de l'image d'origine. */
  eyeDist: number;
  /** Rotation du visage autour de l'axe vertical, roll ANNULÉ. 0 = de face. */
  yaw: number;
  /** Inclinaison de la ligne des yeux, en degrés. */
  roll: number;
};

/**
 * Géométrie du visage à partir des 5 repères YuNet (œil D, œil G, nez, …).
 *
 * Le yaw est mesuré APRÈS avoir annulé le roll : sans cela, une tête simplement
 * penchée serait lue comme une tête tournée (le nez « part » sur le côté dans
 * l'image alors qu'il est resté au milieu du visage).
 */
export function faceGeometry(
  landmarks: readonly [number, number][]
): FaceGeometry | null {
  if (landmarks.length < 3) return null;
  const [eyeR, eyeL, nose] = landmarks;
  const dx = eyeL[0] - eyeR[0];
  const dy = eyeL[1] - eyeR[1];
  const eyeDist = Math.hypot(dx, dy);
  if (eyeDist < 2) return null;

  const theta = Math.atan2(dy, dx); // inclinaison de la ligne des yeux
  const midX = (eyeR[0] + eyeL[0]) / 2;
  const midY = (eyeR[1] + eyeL[1]) / 2;

  // Nez exprimé dans le repère du visage (rotation inverse du roll).
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);
  const nx = (nose[0] - midX) * cos - (nose[1] - midY) * sin;

  return {
    eyeDist,
    yaw: nx / eyeDist,
    roll: (theta * 180) / Math.PI,
  };
}

/** Netteté (variance du Laplacien) + luminosité d'un crop RGB. */
export function cropSharpnessBrightness(crop: RawLike): {
  sharpness: number;
  brightness: number;
} {
  const { width: w, height: h, data } = crop;
  const n = w * h;
  if (n === 0 || w < 3 || h < 3) return { sharpness: 0, brightness: 0 };

  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v =
      0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
    gray[i] = v;
    sum += v;
  }

  let lapSum = 0;
  let lapSq = 0;
  const count = (w - 2) * (h - 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap;
      lapSq += lap * lap;
    }
  }
  const mean = lapSum / count;
  return { sharpness: lapSq / count - mean * mean, brightness: sum / n };
}

export type FaceQuality = {
  verdict: "passed" | "failed";
  /** Confiance globale ∈ [0,1] (le minimum des sous-scores : une seule tare
   *  suffit à rendre une capture inexploitable). */
  score: number;
  reasons: FaceQualityReason[];
  metrics: {
    eyeDist: number;
    sharpness: number;
    brightness: number;
    yaw: number;
    roll: number;
  };
};

/**
 * Qualité d'UN visage : `aligned` est le crop recalé 112×112 (l'image que verra
 * le modèle), `landmarks` sont les repères dans les pixels D'ORIGINE (c'est là
 * que se mesure la vraie résolution).
 */
export function assessFaceQuality(
  aligned: RawLike,
  landmarks: readonly [number, number][]
): FaceQuality {
  const geo = faceGeometry(landmarks);
  const { sharpness, brightness } = cropSharpnessBrightness(aligned);
  const eyeDist = geo?.eyeDist ?? 0;
  const yaw = geo?.yaw ?? 0;
  const roll = geo?.roll ?? 0;

  const reasons: FaceQualityReason[] = [];
  if (eyeDist < MIN_EYE_DIST) reasons.push("face_too_small");
  if (sharpness < MIN_SHARPNESS) reasons.push("blurry");
  if (brightness < BRIGHTNESS_RANGE[0]) reasons.push("too_dark");
  if (brightness > BRIGHTNESS_RANGE[1]) reasons.push("too_bright");
  if (Math.abs(yaw) > MAX_YAW) reasons.push("not_frontal");

  const score = Math.min(
    clamp(sharpness / (MIN_SHARPNESS * 6), 0, 1), // net dès ~300
    clamp(eyeDist / (MIN_EYE_DIST * 2), 0, 1), // plein score dès 60 px
    clamp(
      1 -
        Math.max(
          0,
          BRIGHTNESS_RANGE[0] - brightness,
          brightness - BRIGHTNESS_RANGE[1]
        ) /
          50,
      0,
      1
    ),
    clamp(1 - Math.abs(yaw) / MAX_YAW, 0, 1)
  );

  return {
    verdict: reasons.length === 0 ? "passed" : "failed",
    score: Math.round(score * 1000) / 1000,
    reasons,
    metrics: {
      eyeDist: Math.round(eyeDist),
      sharpness: Math.round(sharpness),
      brightness: Math.round(brightness),
      yaw: Math.round(yaw * 1000) / 1000,
      roll: Math.round(roll * 10) / 10,
    },
  };
}

/**
 * POIDS d'une vue dans le gabarit d'identité (voir lib/idv/face-match.ts).
 *
 * Les frames des défis de présence ne se valent pas : celle où l'utilisateur
 * regarde l'objectif porte l'identité ; celle où il tourne la tête sert à
 * prouver qu'il est vivant, pas à dire QUI il est. Une moyenne bête des deux
 * diluerait la bonne vue dans la mauvaise. On pondère donc chaque vue par ce
 * qu'elle apporte réellement : netteté, résolution, frontalité.
 */
export function faceViewWeight(q: FaceQuality): number {
  const { sharpness, eyeDist, yaw } = q.metrics;
  const w =
    clamp(sharpness / 300, 0.2, 1) *
    clamp(eyeDist / 60, 0.3, 1) *
    clamp(1 - Math.abs(yaw) / MAX_YAW, 0.15, 1);
  return Math.round(w * 1000) / 1000;
}

// ── Empreinte perceptuelle : « ce selfie EST-IL la photo du document ? » ─────
//
// Un fraudeur peut recadrer le portrait de la carte et l'envoyer comme selfie.
// Le cosinus ne le trahit pas (deux vraies photos d'une même personne montent
// jusqu'à 0.93 ; une image rejouée redescend à 0.90 après recompression : les
// deux populations se recouvrent). Il faut donc un signal d'IMAGE et non
// d'identité : deux photos différentes du même visage ont les mêmes traits mais
// jamais les mêmes pixels.

/**
 * dHash du visage recalé (invariant à la luminosité globale).
 *
 * `grid` = 16 → 256 bits. Mesuré : en 64 bits (grille 8), deux photos d'une même
 * SÉANCE (même pose, même lumière) tombaient à 3 bits d'écart, aussi près qu'une
 * image rejouée — les deux populations se touchaient. En 256 bits, la finesse
 * suffit à les séparer franchement : on décrit le visage, plus seulement sa
 * silhouette.
 */
export function faceDHash(aligned: RawLike, grid = 16): bigint {
  const H = grid;
  const S = grid + 1; // (grid+1) colonnes → grid comparaisons horizontales
  const { width, height, data } = aligned;
  const cell = new Float32Array(S * H);

  // Sous-échantillonnage par moyenne de blocs (pas d'interpolation : on veut
  // une empreinte stable, pas une belle image).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < S; x++) {
      const x0 = Math.floor((x * width) / S);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / S));
      const y0 = Math.floor((y * height) / H);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / H));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 3;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      cell[y * S + x] = sum / Math.max(1, n);
    }
  }

  let bits = 0n;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      const i = y * S + x;
      bits = (bits << 1n) | (cell[i] < cell[i + 1] ? 1n : 0n);
    }
  }
  return bits;
}

/** Nombre de bits de l'empreinte (grille 16 ⇒ 256). */
export const FACE_HASH_BITS = 256;

/** Nombre de bits qui diffèrent entre deux empreintes (0 = images identiques). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Sous cette distance (sur 256 bits), le selfie et le portrait du document sont
 * la MÊME image : ce n'est plus une vérification d'identité, c'est un
 * copier-coller. Le dossier part alors en REVUE HUMAINE — jamais en refus
 * automatique : c'est un signal, pas une preuve.
 *
 * Mesuré (scripts/idv-measure-replay.mjs, 13 identités) :
 *   • portrait du document rejoué en selfie … 7 à 29 bits d'écart ;
 *   • vraie autre photo de la même personne … 13 à 152, médiane 118.
 * Le seul cas légitime sous 30 est un artefact du corpus (deux photos de presse
 * d'une même rafale — la même image, à la milliseconde près). En production,
 * une photo d'identité imprimée et un selfie pris à l'instant ne peuvent pas
 * partager leurs pixels : autre appareil, autre lumière, autre année.
 */
export const REPLAY_HAMMING_MAX = 32;
