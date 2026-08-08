// Squelette de l'onglet Catégories (hub Plateforme) : la page await côté
// serveur → frontière de chargement obligatoire pour une nav instantanée.
export default function LoadingCategories() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-2 h-6 w-56 rounded-sm" />
      <div className="bg-surface-2 mt-2 h-4 w-80 rounded-sm" />
      <div className="border-border bg-surface mt-6 space-y-3 rounded-lg border p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="bg-surface-2 size-11 rounded-full" />
            <div className="bg-surface-2 h-4 flex-1 rounded-sm" />
            <div className="bg-surface-2 rounded-control h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
