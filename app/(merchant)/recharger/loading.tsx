/**
 * Squelette « Recharger » (Coligo Pay commerçant) — affiché INSTANTANÉMENT à la
 * navigation (depuis le wallet du dashboard ou le bouton Finances) pendant que
 * le chunk d'OperatorRecharge se charge. Évite l'écran blanc → transition
 * ressentie ultra rapide, comme les autres partenaires (livreur/chauffeur).
 */
export default function RechargerLoading() {
  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto max-w-[480px] animate-pulse space-y-4">
        {/* Titre */}
        <div className="bg-surface-3 h-6 w-40 rounded-[10px]" />
        {/* Hero solde */}
        <div className="bg-surface-3 h-28 w-full rounded-[20px]" />
        {/* Sélecteur de méthode (3 chips) */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-surface-3 h-12 rounded-[14px]" />
          <div className="bg-surface-3 h-12 rounded-[14px]" />
          <div className="bg-surface-3 h-12 rounded-[14px]" />
        </div>
        {/* Montants */}
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface-3 h-11 rounded-[12px]" />
          ))}
        </div>
        {/* CTA */}
        <div className="bg-surface-3 h-12 w-full rounded-[14px]" />
      </div>
    </div>
  );
}
