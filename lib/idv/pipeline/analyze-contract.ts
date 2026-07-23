// =============================================================================
// IDV — CONTRAT des routes internes d'analyse (pur, partagé entre les routes et
// les server actions qui les appellent). Versionné : tout changement de forme
// = bump de ANALYZE_CONTRACT_VERSION.
// =============================================================================
import type { FaceQuality } from "@/lib/idv/pipeline/face-quality";

/** v2 : qualité biométrique + ambiguïté de visage + gabarit multi-vues. */
export const ANALYZE_CONTRACT_VERSION = 2;

export type AnalyzeDocumentRequest = {
  /** Chemins dans le bucket privé idv-captures. */
  frontPath: string;
  backPath?: string | null;
  /** null = document sans MRZ (permis) → contrôle MRZ sauté. */
  mrzFormat: "td1" | "td3" | null;
};

export type AnalyzedCheckKey =
  | "doc_face"
  | "mrz"
  | "doc_expiry"
  | "ocr_extract";

export type AnalyzedCheck = {
  key: AnalyzedCheckKey;
  status: "passed" | "failed" | "skipped" | "error";
  score: number | null;
  /** true = l'utilisateur peut simplement reprendre la photo (pas un signal
   *  de fraude) : MRZ introuvable, portrait non détecté… */
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type AnalyzeDocumentResponse =
  | {
      ok: true;
      checks: AnalyzedCheck[];
      /** Champs extraits (MRZ validée) — null sinon. */
      extracted: Record<string, unknown> | null;
      /** ISO yyyy-mm-dd (expiration du document) — null si inconnue. */
      documentExpiresAt: string | null;
    }
  | { ok: false; error: string };

// ── Selfie (étape 6) : géométrie + embedding par frame, jugement côté action ─

export type AnalyzeSelfieRequest = {
  /** Chemins des frames dans idv-captures, ORDRE = défis (0 = centre). */
  paths: string[];
};

export type AnalyzedFrame = {
  face: {
    x: number;
    y: number;
    w: number;
    h: number;
    score: number;
    /** 5 repères YuNet (œil D, œil G, nez, bouche D, bouche G). */
    landmarks: [number, number][];
    imageW: number;
    imageH: number;
  } | null;
  /** Embedding SFace L2-normalisé (128) — null si aucun visage. */
  embedding: number[] | null;
  /** Anti-spoof PASSIF (MiniFASNetV2) : p(visage vivant) ∈ [0,1].
   *  null = pas de visage, ou modèle indisponible (dégradé non bloquant). */
  passiveLiveness: number | null;
  /** Qualité biométrique de la frame (netteté, résolution, pose) — ce que le
   *  modèle voit réellement. null si aucun visage. */
  quality: FaceQuality | null;
  /** Aire du 2e visage relative au principal : > 0 ⇒ quelqu'un d'autre est
   *  dans le cadre (complice, portrait brandi) et « le plus grand » n'est plus
   *  une réponse fiable. */
  rival: number;
};

export type AnalyzeSelfieResponse =
  | { ok: true; frames: AnalyzedFrame[] }
  | { ok: false; error: string };

// ── Face match (étape 7) : portrait du document ↔ selfie ────────────────────

export type FaceMatchRequest = {
  /** Recto du document (le portrait y est re-localisé). */
  docPath: string;
  /** Frame selfie de référence (défi « center »). */
  selfiePath: string;
  /** Autres frames du selfie (défis). Toutes les vues exploitables entrent dans
   *  le GABARIT d'identité, pondérées par ce qu'elles apportent (netteté,
   *  résolution, frontalité) — voir lib/idv/face-match.ts. */
  framePaths?: string[];
};

export type FaceMatchResponse =
  | {
      ok: true;
      /** Score NORMALISÉ [0,1] — comparable aux seuils DB (idv_modes). */
      score: number;
      /** Cosinus SFace du gabarit ∈ [-1,1] (traçabilité / recalibrage). */
      cosine: number;
      docFaceFound: boolean;
      selfieFaceFound: boolean;
      /** Nombre de vues du selfie entrées dans le gabarit (≥ 1). */
      framesCompared?: number;
      /** Passe de détection qui a trouvé le portrait (audit : « rot90 »,
       *  « upscale2 »… disent ce que la caméra de l'utilisateur a donné). */
      docPass?: string;
      /** Qualité du portrait du document et de la meilleure vue du selfie. */
      docQuality?: FaceQuality | null;
      selfieQuality?: FaceQuality | null;
      /** Cosinus de chaque vue (audit : une vue aberrante se voit ici). */
      viewCosines?: number[];
      /**
       * Distance perceptuelle entre le visage du DOCUMENT et celui du SELFIE.
       * Très faible ⇒ ce n'est pas une ressemblance, c'est la MÊME image :
       * quelqu'un a renvoyé le portrait de la carte en guise de selfie.
       */
      replayDistance?: number;
      replaySuspected?: boolean;
      /** Un 2e visage occupe le cadre du document ou du selfie. */
      docRival?: number;
      selfieRival?: number;
    }
  | { ok: false; error: string };
