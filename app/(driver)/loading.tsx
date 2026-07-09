/**
 * Frontière de chargement de l'espace livreur (groupe `(driver)`), affichée
 * notamment à la 1ʳᵉ entrée depuis le portail commerçant.
 *
 * Volontairement SANS écran de lancement (plus de splash violet plein écran,
 * plus d'animation de logo) : on rend immédiatement un squelette neutre sur le
 * fond de l'espace livreur, puis le contenu se streame. Le passage d'un portail
 * à l'autre est donc ressenti comme une navigation, pas comme un relancement
 * d'application.
 */
export default function DriverLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="mx-auto max-w-md px-5 pt-4 pb-24">
        <div className="space-y-4 pt-1">
          <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--soft)]" />
          <div className="h-28 animate-pulse rounded-[18px] bg-[var(--soft)]" />
          <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
          <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
        </div>
      </main>
    </div>
  );
}
