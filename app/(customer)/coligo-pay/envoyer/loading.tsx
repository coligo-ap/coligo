/**
 * Squelette de l'ENVOI Coligo Pay — content-only (coque persistante) :
 * destinataire, montant et bouton fantômes.
 */
export default function ColigoPayEnvoyerLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-52 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mt-4 h-14 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mt-3 h-24 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mt-3 h-14 animate-pulse rounded-lg" />
      <div className="bg-surface-3 rounded-card-lg mt-4 h-12 w-full animate-pulse" />
    </div>
  );
}
