/**
 * Frontière de chargement — squelette au tap (règle produit : une route qui
 * `await` au serveur SANS `loading.tsx` donne l'impression que rien ne se
 * passe, et le prefetch du lien ne sert à rien).
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="bg-surface-2 h-9 w-40 animate-pulse rounded-full" />
      <div className="bg-surface-2 h-32 animate-pulse rounded-lg" />
      <div className="bg-surface-2 h-24 animate-pulse rounded-lg" />
    </div>
  );
}
