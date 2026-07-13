import { join } from "node:path";
import * as ort from "onnxruntime-node";

// =============================================================================
// IDV — registre des sessions ONNX (serveur uniquement). Un modèle se charge
// UNE fois par instance (Vercel Fluid garde l'instance chaude) puis se
// partage entre requêtes. Jamais d'import côté client.
// =============================================================================

/** Modèles embarqués dans le déploiement (models/idv/, tracés par
 *  outputFileTracingIncludes — voir next.config.ts). Empreintes vérifiées par
 *  scripts/idv-fetch-models.mjs. */
export const IDV_MODELS = {
  yunet: "face_detection_yunet_2023mar.onnx",
  sface: "face_recognition_sface_2021dec.onnx",
  minifasnet: "minifasnet_v2.onnx",
} as const;
export type IdvModelKey = keyof typeof IDV_MODELS;

export function idvModelPath(key: IdvModelKey): string {
  return join(process.cwd(), "models", "idv", IDV_MODELS[key]);
}

export type IdvSession = {
  session: ort.InferenceSession;
  /** Durée du chargement (0 si déjà chaud pour cette instance). */
  loadMs: number;
};

const sessions = new Map<IdvModelKey, Promise<IdvSession>>();

/** Charge (ou réutilise) la session du modèle. Thread-safe par promesse
 *  partagée ; un échec de chargement n'empoisonne pas le cache. */
export function getIdvSession(key: IdvModelKey): Promise<IdvSession> {
  let pending = sessions.get(key);
  if (!pending) {
    pending = (async () => {
      const t0 = performance.now();
      const session = await ort.InferenceSession.create(idvModelPath(key), {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        // Instance partagée entre requêtes (Fluid) : rester sobre en threads.
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        // Erreurs seulement (l'export MXNet de SFace spamme des warnings
        // d'optimisation sans conséquence).
        logSeverityLevel: 3,
      });
      return { session, loadMs: Math.round(performance.now() - t0) };
    })();
    pending.catch(() => sessions.delete(key));
    sessions.set(key, pending);
  }
  return pending;
}

/** L'instance a-t-elle déjà chargé au moins un modèle ? (mesure cold start). */
export function idvRuntimeWarm(): boolean {
  return sessions.size > 0;
}
