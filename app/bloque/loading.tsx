/**
 * Frontière de chargement de l'écran « accès bloqué » (`force-dynamic`, lit un
 * message via RPC). Reproduit la carte centrée : pastille ronde + titre + texte,
 * pour que le tap ne laisse pas d'écran blanc pendant l'aller-retour serveur.
 */
export default function Loading() {
  return (
    <div className="bg-surface-2 flex min-h-screen items-center justify-center p-6">
      <div className="border-border rounded-sheet-lg w-full max-w-md border bg-white p-8 text-center shadow-sm">
        <span className="bg-surface-3 mx-auto block size-14 animate-pulse rounded-full" />
        <span className="bg-surface-3 mx-auto mt-4 block h-6 w-40 animate-pulse rounded-lg" />
        <div className="mt-3 space-y-2">
          <span className="bg-surface-3 mx-auto block h-4 w-full max-w-xs animate-pulse rounded-lg" />
          <span className="bg-surface-3 mx-auto block h-4 w-2/3 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
}
