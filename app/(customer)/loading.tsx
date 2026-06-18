/**
 * Squelette de chargement de l'espace CLIENT (frontière `loading.tsx` du groupe
 * `(customer)`). Rendu À L'INTÉRIEUR de la coque PERSISTANTE (CustomerChrome :
 * header + barre du bas + footer), dans le `<main>` → il ne doit contenir QUE le
 * squelette du CONTENU. (Re-dessiner la coque ici provoquait un « loading
 * global » qui clignotait par-dessus la vraie coque = sensation de
 * rechargement.) Le thème est hérité du `data-space="client"` de la coque.
 */
export default function CustomerLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-24 lg:pb-8">
      <div className="bg-surface-3 h-7 w-48 animate-pulse rounded-lg" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-28 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
        <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
        <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
      </div>
    </div>
  );
}
