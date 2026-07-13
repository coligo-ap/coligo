// =============================================================================
// IDV — CONTRAT de la route interne /api/idv/analyze-document (pur, partagé
// entre la route et les server actions qui l'appellent). Versionné : tout
// changement de forme = bump de ANALYZE_CONTRACT_VERSION.
// =============================================================================

export const ANALYZE_CONTRACT_VERSION = 1;

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
};

export type AnalyzeSelfieResponse =
  | { ok: true; frames: AnalyzedFrame[] }
  | { ok: false; error: string };
