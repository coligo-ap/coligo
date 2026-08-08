/**
 * Squelette « Mon téléphone » — page à COQUE PROPRE (chrome masqué) : en-tête
 * sticky (retour + titre) + champ et bouton fantômes.
 */
export default function CompteTelephoneLoading() {
  return (
    <div className="bg-surface-2 min-h-screen">
      <header className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 dark:bg-[var(--color-surface)]">
        <div className="bg-surface-2 size-9 animate-pulse rounded-full" />
        <div className="bg-surface-2 h-6 w-40 animate-pulse rounded-lg" />
      </header>
      <div className="mx-auto max-w-xl space-y-3 px-4 py-5">
        <div className="rounded-card-lg h-14 animate-pulse bg-white dark:bg-[var(--color-surface)]" />
        <div className="bg-primary-100 rounded-card-lg h-12 animate-pulse" />
      </div>
    </div>
  );
}
