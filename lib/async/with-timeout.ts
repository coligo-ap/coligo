/**
 * Borne une promesse par un garde-temps. INDISPENSABLE autour des Server Actions
 * réseau : un `try/finally` ne libère RIEN si la promesse ne se résout jamais
 * (fonction serverless froide, réseau qui stalle, action périmée après déploie).
 * Sans ça, un bouton passé en `loading` avant l'`await` tourne à l'infini.
 *
 *   try {
 *     const r = await withTimeout(requestDriveRide(p), 15000);
 *   } catch {
 *     setError("Réessaie"); // timeout OU erreur → message + bouton réactivé
 *   } finally {
 *     setLoading(false); // garanti : la promesse SE règle toujours (au pire, rejet)
 *   }
 *
 * Rejette avec `TimeoutError` au bout de `ms`. La promesse d'origine continue en
 * arrière-plan (on ne peut pas annuler un Server Action) mais son résultat est
 * ignoré — l'UI n'est plus bloquée.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout après ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Variante SERVEUR : résout `null` au lieu de rejeter. Pour les résolutions
 * d'identité/gate côté RSC (getCurrentDriver, getIdvGate, getMyLatestIdvVerification…)
 * qui tournent DANS un layout ou une page — un rejet non catché y ferait planter
 * tout le rendu (page d'erreur), pire qu'une session traitée comme absente.
 * Même ressort que le `withTimeout` local de lib/supabase/middleware.ts (getUser
 * borné à 4 s) : un socket à moitié mort après une longue veille app ne doit
 * JAMAIS laisser un `await` serveur pendre indéfiniment — ce qui gèle TOUTE la
 * navigation de l'espace (le layout/page ne finit jamais de streamer).
 */
export function withTimeoutOrNull<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
