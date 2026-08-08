/**
 * Squelette affiché pendant le chargement d'une section commerçant. La coque
 * (layout partagé) reste montée ; seul ce contenu apparaît instantanément, ce
 * qui rend la navigation fluide même quand la page interroge la base (réseau
 * lent / heures de pointe). Active aussi le prefetch des routes dynamiques.
 */
export default function MerchantLoading() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <div className="bg-surface-3 mb-6 h-8 w-52 animate-pulse rounded-md" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-24 animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-surface-3 h-64 animate-pulse rounded-lg lg:col-span-2" />
        <div className="bg-surface-3 h-64 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}
