/**
 * Squelette « Mes informations » — page à COQUE PROPRE (chrome masqué sur
 * /compte/infos) : on rend l'en-tête sticky (retour + titre) + formulaire
 * fantôme pour que le tap réponde immédiatement.
 */
export default function CompteInfosLoading() {
  return (
    <div className="bg-surface-2 min-h-screen">
      <header className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 dark:bg-[var(--color-surface)]">
        <div className="bg-surface-2 size-9 animate-pulse rounded-full" />
        <div className="bg-surface-2 h-6 w-44 animate-pulse rounded-lg" />
      </header>
      <div className="mx-auto max-w-xl space-y-3 px-4 py-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-[14px] bg-white dark:bg-[var(--color-surface)]"
          />
        ))}
        <div className="bg-primary-100 h-12 animate-pulse rounded-[14px]" />
      </div>
    </div>
  );
}
