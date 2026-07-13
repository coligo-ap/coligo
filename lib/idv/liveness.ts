import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// =============================================================================
// IDV — LIVENESS ACTIF : défis aléatoires ÉMIS et VÉRIFIÉS PAR LE SERVEUR.
// Le client n'est qu'un appareil photo à compte à rebours ; la géométrie du
// visage (YuNet : boîte + 5 repères) est jugée ICI, sur les frames reçues.
//
// Défis : centre (référence), tourner la tête (gauche OU droite, tiré au
// sort), se rapprocher. Une photo imprimée/écran ne produit pas la parallaxe
// nez↔yeux d'une vraie rotation 3D ; l'ordre aléatoire + le jeton HMAC à
// expiration courte bloquent le rejeu ; la cohérence SFace entre frames
// bloque l'échange de visage entre deux étapes.
//
// Géométrie pure (testée au banc sur fixtures) + jeton HMAC (node:crypto).
// Frames capturées NON-MIROIR : l'utilisateur qui tourne la tête vers SA
// gauche voit son nez se déplacer vers la DROITE de l'image caméra.
// =============================================================================

export const IDV_CHALLENGES = [
  "center",
  "turn_left",
  "turn_right",
  "closer",
] as const;
export type IdvChallenge = (typeof IDV_CHALLENGES)[number];

/** Durée de vie d'une session de défis (ms). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Séquence : référence au centre, puis rotation aléatoire, puis approche. */
export function drawChallenges(): IdvChallenge[] {
  const turn: IdvChallenge = randomInt(2) === 0 ? "turn_left" : "turn_right";
  return ["center", turn, "closer"];
}

// ── Jeton anti-rejeu (stateless : HMAC du contexte + expiration) ─────────────

function tokenPayload(
  verificationId: string,
  challenges: readonly IdvChallenge[],
  expiresAtMs: number
): string {
  return `${verificationId}|${challenges.join(",")}|${expiresAtMs}`;
}

export function issueChallengeToken(
  secret: string,
  verificationId: string,
  challenges: readonly IdvChallenge[],
  expiresAtMs: number
): string {
  return createHmac("sha256", secret)
    .update(tokenPayload(verificationId, challenges, expiresAtMs))
    .digest("hex");
}

export function verifyChallengeToken(
  secret: string,
  token: string,
  verificationId: string,
  challenges: readonly IdvChallenge[],
  expiresAtMs: number,
  nowMs = Date.now()
): boolean {
  if (!token || nowMs > expiresAtMs) return false;
  if (challenges.length < 2 || challenges[0] !== "center") return false;
  if (challenges.some((c) => !IDV_CHALLENGES.includes(c))) return false;
  const expected = issueChallengeToken(
    secret,
    verificationId,
    challenges,
    expiresAtMs
  );
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Géométrie ────────────────────────────────────────────────────────────────

/** Visage détecté sur une frame (repères YuNet : œil D, œil G, nez, bouche
 *  D, bouche G — coordonnées image) + dimensions de la frame. */
export type FrameFace = {
  x: number;
  y: number;
  w: number;
  h: number;
  landmarks: [number, number][];
  imageW: number;
  imageH: number;
};

export type FaceMetrics = {
  /** Décalage du nez vs milieu des yeux, normalisé par l'écart inter-yeux.
   *  > 0 = nez vers la droite de l'image = sujet tourné vers SA gauche. */
  yaw: number;
  /** Largeur du visage relative à la frame. */
  size: number;
  /** Centre du visage, normalisé [0,1]. */
  cx: number;
  cy: number;
  /** Écart inter-yeux en pixels (garde anti-photo inclinée). */
  eyeDist: number;
};

export function faceMetrics(face: FrameFace): FaceMetrics | null {
  if (face.landmarks.length < 3 || face.imageW <= 0 || face.w <= 0) return null;
  const [eyeR, eyeL, nose] = face.landmarks;
  const eyeDist = Math.hypot(eyeL[0] - eyeR[0], eyeL[1] - eyeR[1]);
  if (eyeDist < 4) return null;
  const midX = (eyeR[0] + eyeL[0]) / 2;
  return {
    yaw: (nose[0] - midX) / eyeDist,
    size: face.w / face.imageW,
    cx: (face.x + face.w / 2) / face.imageW,
    cy: (face.y + face.h / 2) / face.imageH,
    eyeDist,
  };
}

// Seuils de géométrie (physique de la pose, pas une politique produit).
const MIN_CENTER_SIZE = 0.2; // visage ≥ 20 % de la largeur au centre
const CENTER_BOX = 0.28; // centre du visage à ±28 % du milieu
const YAW_DELTA = 0.15; // rotation franche vs référence
const EYE_COLLAPSE = 0.55; // yeux « écrasés » = photo inclinée, pas une pose
const CLOSER_RATIO = 1.18; // rapprochement ≥ 18 %

export type ChallengeVerdict = {
  challenge: IdvChallenge;
  passed: boolean;
  reason: string | null;
};

/** Vérifie UN défi contre la frame de référence (centre). */
export function verifyChallenge(
  challenge: IdvChallenge,
  neutral: FaceMetrics,
  frame: FaceMetrics
): ChallengeVerdict {
  const fail = (reason: string) => ({ challenge, passed: false, reason });
  switch (challenge) {
    case "center": {
      if (frame.size < MIN_CENTER_SIZE) return fail("face_too_small");
      if (
        Math.abs(frame.cx - 0.5) > CENTER_BOX ||
        Math.abs(frame.cy - 0.5) > CENTER_BOX
      )
        return fail("face_off_center");
      return { challenge, passed: true, reason: null };
    }
    case "turn_left":
    case "turn_right": {
      // Une photo qu'on incline « écrase » l'écart inter-yeux SANS produire
      // la parallaxe nez↔yeux d'une vraie rotation 3D.
      if (frame.eyeDist < neutral.eyeDist * EYE_COLLAPSE)
        return fail("eye_distance_collapsed");
      const delta = frame.yaw - neutral.yaw;
      const wanted = challenge === "turn_left" ? delta : -delta;
      if (wanted < YAW_DELTA) return fail("head_turn_not_detected");
      return { challenge, passed: true, reason: null };
    }
    case "closer": {
      if (frame.size < neutral.size * CLOSER_RATIO) return fail("not_closer");
      return { challenge, passed: true, reason: null };
    }
  }
}

export type LivenessEvaluation = {
  /** Score ∈ [0,1] : part de défis réussis (référence comprise). */
  score: number;
  passed: boolean;
  verdicts: ChallengeVerdict[];
};

/**
 * Évalue la séquence complète. `faces[i]` correspond à `challenges[i]`
 * (frame 0 = centre/référence). Un visage manquant sur une frame = échec de
 * ce défi (reason no_face).
 */
export function evaluateLiveness(
  challenges: readonly IdvChallenge[],
  faces: readonly (FrameFace | null)[]
): LivenessEvaluation {
  const verdicts: ChallengeVerdict[] = [];
  const neutralFace = faces[0] ? faceMetrics(faces[0]) : null;
  for (let i = 0; i < challenges.length; i++) {
    const challenge = challenges[i];
    const face = faces[i] ? faceMetrics(faces[i]!) : null;
    if (!face) {
      verdicts.push({ challenge, passed: false, reason: "no_face" });
      continue;
    }
    if (i === 0) {
      verdicts.push(verifyChallenge("center", face, face));
      continue;
    }
    if (!neutralFace) {
      verdicts.push({ challenge, passed: false, reason: "no_reference" });
      continue;
    }
    verdicts.push(verifyChallenge(challenge, neutralFace, face));
  }
  const passedCount = verdicts.filter((v) => v.passed).length;
  const score =
    Math.round((passedCount / Math.max(1, challenges.length)) * 1000) / 1000;
  return { score, passed: passedCount === challenges.length, verdicts };
}

/** Cosinus de deux embeddings L2-normalisés (tableaux JSON de la route). */
export function embeddingCosine(
  a: readonly number[],
  b: readonly number[]
): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Seuil de « même personne entre deux frames » — volontairement BAS (crops
 *  non alignés, poses différentes) : il attrape l'échange de visage, pas les
 *  variations de pose. */
export const FRAME_CONSISTENCY_MIN = 0.35;
